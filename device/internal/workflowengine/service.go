package workflowengine

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

func Run(ctx context.Context, cfg *Config) error {
	slog.Info("trakrai workflow-engine starting",
		"redis", redisconfig.Address(cfg.Redis),
		"queue", cfg.Queue.FrameQueueKey,
		"socket", cfg.IPC.SocketPath,
		"workflow_definition", cfg.Workflow.DefinitionPath,
	)

	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisconfig.Address(cfg.Redis),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping failed: %w", err)
	}

	ipcClient := ipc.NewClient(cfg.IPC.SocketPath, ServiceName)
	ipcClient.Start()
	defer ipcClient.Close()

	loader := newWorkflowLoader(cfg.Workflow, builtinRegistry())
	status := &statusSnapshot{}
	reportTicker := time.NewTicker(time.Duration(cfg.Status.ReportIntervalSec) * time.Second)
	defer reportTicker.Stop()

	if err := ipcClient.ReportStatus("idle", map[string]interface{}{
		"queue":               cfg.Queue.FrameQueueKey,
		"redis":               redisconfig.Address(cfg.Redis),
		"workflow_definition": cfg.Workflow.DefinitionPath,
	}); err != nil {
		slog.Debug("initial status report failed", "error", err)
	}

	for {
		select {
		case <-ctx.Done():
			if err := ipcClient.ReportStatus("stopped", map[string]interface{}{"reason": "shutdown"}); err != nil {
				slog.Debug("final status report failed", "error", err)
			}
			return nil
		case <-reportTicker.C:
			if err := ipcClient.ReportStatus("running", status.statusDetails(cfg.Queue.FrameQueueKey)); err != nil {
				slog.Debug("periodic status report failed", "error", err)
			}
		default:
		}

		frame, err := popQueueEnvelope(ctx, redisClient, cfg)
		if err != nil {
			if err == redis.Nil {
				continue
			}
			if ctx.Err() != nil {
				return nil
			}
			status.noteInvalid(err)
			reportRuntimeError(ipcClient, "queue read failed", err)
			slog.Warn("workflow queue read failed", "error", err)
			time.Sleep(time.Second)
			continue
		}

		status.noteReceived(frame)
		if isStaleFrame(frame, cfg) {
			status.noteStale(frame)
			slog.Warn("dropping stale workflow frame",
				"camera", frame.CameraName,
				"frame_id", frame.FrameID,
				"enqueued_at", frame.EnqueuedAt,
			)
			if err := ipcClient.ReportStatus("stale-frame", status.statusDetails(cfg.Queue.FrameQueueKey)); err != nil {
				slog.Debug("stale-frame status report failed", "error", err)
			}
			continue
		}

		workflowFrame, err := hydrateWorkflowFrame(ctx, redisClient, frame)
		if err != nil {
			status.noteMissingDetections(frame, err)
			reportRuntimeError(ipcClient, "workflow frame hydration failed", err)
			slog.Warn("workflow frame hydration failed",
				"camera", frame.CameraName,
				"frame_id", frame.FrameID,
				"detections_key", frame.DetectionsKey,
				"error", err,
			)
			continue
		}

		engine, workflowName, err := loader.ensureLoaded()
		if err != nil {
			status.noteInvalid(err)
			reportRuntimeError(ipcClient, "workflow load failed", err)
			slog.Warn("workflow definition load failed", "error", err)
			continue
		}
		if engine == nil {
			status.noteProcessed(workflowFrame)
			if err := ipcClient.ReportStatus("frame-ready", status.statusDetails(cfg.Queue.FrameQueueKey)); err != nil {
				slog.Debug("frame-ready status report failed", "error", err)
			}
			slog.Info("workflow frame hydrated without loaded workflow",
				"camera", workflowFrame.Envelope.CameraName,
				"frame_id", workflowFrame.Envelope.FrameID,
				"detections", workflowFrame.Detections.TotalDetection,
			)
			continue
		}

		payload := buildWorkflowPayload(workflowFrame)
		execResult, err := engine.Execute(workflowFrame, payload)
		if err != nil {
			status.noteInvalid(err)
			reportRuntimeError(ipcClient, "workflow execution failed", err)
			slog.Warn("workflow execution failed",
				"camera", workflowFrame.Envelope.CameraName,
				"frame_id", workflowFrame.Envelope.FrameID,
				"workflow", workflowName,
				"error", err,
			)
			continue
		}

		status.noteWorkflowResult(workflowFrame, workflowName, execResult)
		for _, action := range execResult.Actions {
			if err := ipcClient.SendServiceMessage(
				action.TargetService,
				defaultSubtopic(action.Subtopic, "command"),
				action.Type,
				action.Payload,
			); err != nil {
				status.noteInvalid(err)
				reportRuntimeError(ipcClient, "workflow action dispatch failed", err)
				slog.Warn("workflow action dispatch failed",
					"camera", workflowFrame.Envelope.CameraName,
					"frame_id", workflowFrame.Envelope.FrameID,
					"target_service", action.TargetService,
					"type", action.Type,
					"error", err,
				)
				continue
			}
			status.noteDispatchedAction(action)
		}

		if err := ipcClient.ReportStatus("frame-ready", status.statusDetails(cfg.Queue.FrameQueueKey)); err != nil {
			slog.Debug("frame-ready status report failed", "error", err)
		}

		slog.Info("workflow frame executed",
			"camera", workflowFrame.Envelope.CameraName,
			"frame_id", workflowFrame.Envelope.FrameID,
			"detections", workflowFrame.Detections.TotalDetection,
			"workflow", workflowName,
			"success", execResult.Success,
			"actions", len(execResult.Actions),
			"queue_latency_ms", workflowFrame.QueueLatency.Milliseconds(),
		)
	}
}

func isStaleFrame(frame *QueueEnvelope, cfg *Config) bool {
	if cfg.Queue.StaleAfterSec <= 0 || frame.EnqueuedAt.IsZero() {
		return false
	}
	return time.Since(frame.EnqueuedAt) > time.Duration(cfg.Queue.StaleAfterSec)*time.Second
}

func reportRuntimeError(ipcClient *ipc.Client, prefix string, err error) {
	message := fmt.Sprintf("%s: %v", prefix, err)
	if reportErr := ipcClient.ReportError(message, false); reportErr != nil {
		slog.Debug("error report failed", "error", reportErr)
	}
}

func defaultSubtopic(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}
