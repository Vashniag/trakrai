package livefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type liveLayoutPayload struct {
	CameraName  string   `json:"cameraName"`
	Camera      string   `json:"camera"`
	CameraNames []string `json:"cameraNames"`
	FrameSource string   `json:"frameSource"`
	LayoutMode  string   `json:"layoutMode"`
	RequestID   string   `json:"requestId"`
	SessionID   string   `json:"sessionId"`
}

func Run(ctx context.Context, cfg *Config) error {
	slog.Info("trakrai live-feed starting",
		"redis", redisconfig.Address(cfg.Redis),
		"socket", cfg.IPC.SocketPath,
	)

	GstInit()
	slog.Info("GStreamer initialized")

	frameSource, err := NewFrameSource(cfg.Redis)
	if err != nil {
		return err
	}
	defer frameSource.Close()

	ipcClient := ipc.NewClient(cfg.IPC.SocketPath, ServiceName)
	ipcClient.Start()
	defer ipcClient.Close()

	if err := ipcClient.ReportStatus("idle", map[string]interface{}{
		"available": true,
		"redis":     redisconfig.Address(cfg.Redis),
	}); err != nil {
		slog.Debug("initial status report failed", "error", err)
	}

	sessions := NewSessionManager(cfg, frameSource, ipcClient)
	go handleNotifications(ctx, ipcClient, sessions)

	slog.Info("live-feed ready, waiting for IPC notifications")
	<-ctx.Done()

	sessions.StopSession("")
	if err := ipcClient.ReportStatus("stopped", map[string]interface{}{"reason": "shutdown"}); err != nil {
		slog.Debug("final status report failed", "error", err)
	}

	return nil
}

func handleNotifications(ctx context.Context, ipcClient *ipc.Client, sessions *SessionManager) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-ipcClient.Notifications():
			if !ok {
				slog.Warn("IPC notification stream closed")
				return
			}
			if notification.Method != "mqtt-message" {
				continue
			}

			var msg ipc.MqttMessageNotification
			if err := json.Unmarshal(notification.Params, &msg); err != nil {
				slog.Warn("invalid MQTT IPC notification", "error", err)
				continue
			}

			switch msg.Subtopic {
			case "command":
				handleCommand(ipcClient, sessions, msg.Envelope)
			case "webrtc/answer":
				handleWebRTCAnswer(msg.Envelope, sessions)
			case "webrtc/ice":
				handleWebRTCIce(msg.Envelope, sessions)
			default:
				slog.Debug("ignoring IPC notification", "subtopic", msg.Subtopic)
			}
		}
	}
}

func handleCommand(ipcClient *ipc.Client, sessions *SessionManager, env ipc.MQTTEnvelope) {
	switch env.Type {
	case "start-live", "start":
		var payload liveLayoutPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			slog.Warn("invalid start-live payload", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("invalid start-live payload: %v", err), false)
			return
		}

		plan, err := layoutPlanFromPayload(payload)
		if err != nil {
			slog.Warn("start-live payload invalid", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("invalid start-live payload: %v", err), false)
			return
		}

		if err := ipcClient.ReportStatus("starting", mergeLayoutDetails(plan, map[string]interface{}{
			"camera": plan.PrimaryCamera(),
		})); err != nil {
			slog.Debug("status report failed", "error", err)
		}
		go sessions.StartSession(plan, payload.RequestID)

	case "update-live-layout":
		var payload liveLayoutPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			slog.Warn("invalid update-live-layout payload", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("invalid update-live-layout payload: %v", err), false)
			return
		}

		plan, err := layoutPlanFromPayload(payload)
		if err != nil {
			slog.Warn("update-live-layout payload invalid", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("invalid update-live-layout payload: %v", err), false)
			return
		}

		if err := sessions.UpdateSessionLayout(payload.SessionID, payload.RequestID, plan); err != nil {
			slog.Warn("update-live-layout failed", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("update-live-layout failed: %v", err), false)
		}

	case "stop-live", "stop":
		var payload struct {
			SessionID string `json:"sessionId"`
		}
		if len(env.Payload) > 0 {
			if err := json.Unmarshal(env.Payload, &payload); err != nil {
				slog.Warn("invalid stop-live payload", "error", err)
			}
		}

		sessions.StopSession(payload.SessionID)

	default:
		slog.Warn("unknown live-feed command", "type", env.Type)
	}
}

func layoutPlanFromPayload(payload liveLayoutPayload) (LiveLayoutPlan, error) {
	cameraName := payload.CameraName
	if cameraName == "" {
		cameraName = payload.Camera
	}

	return NormalizeLiveLayoutPlan(
		payload.LayoutMode,
		cameraName,
		payload.CameraNames,
		payload.FrameSource,
	)
}

func handleWebRTCAnswer(env ipc.MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		SDP       string `json:"sdp"`
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid SDP answer payload", "error", err)
		return
	}
	sessions.SetRemoteAnswer(payload.SessionID, payload.SDP)
}

func handleWebRTCIce(env ipc.MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		Candidate json.RawMessage `json:"candidate"`
		SessionID string          `json:"sessionId"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid ICE candidate payload", "error", err)
		return
	}
	sessions.AddICECandidate(payload.SessionID, payload.Candidate)
}
