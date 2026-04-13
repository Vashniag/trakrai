package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

const liveFeedServiceName = "live-feed"

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	flag.Parse()

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	var level slog.Level
	switch cfg.LogLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))

	slog.Info("trakrai live-feed starting",
		"redis", fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
		"socket", cfg.IPC.SocketPath,
	)

	GstInit()
	slog.Info("GStreamer initialized")

	frameSrc, err := NewFrameSource(cfg)
	if err != nil {
		slog.Error("redis connect failed", "error", err)
		os.Exit(1)
	}
	defer frameSrc.Close()

	ipcClient := NewIPCClient(cfg.IPC.SocketPath, liveFeedServiceName)
	if err := ipcClient.Connect(); err != nil {
		slog.Error("IPC connect failed", "error", err)
		os.Exit(1)
	}
	defer ipcClient.Close()

	if err := ipcClient.ReportStatus("running", map[string]interface{}{
		"redis": fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
	}); err != nil {
		slog.Warn("initial status report failed", "error", err)
	}

	sessions := NewSessionManager(cfg, frameSrc, ipcClient)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go handleNotifications(ctx, ipcClient, sessions)

	slog.Info("live-feed ready, waiting for IPC notifications")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	slog.Info("received signal, shutting down", "signal", sig)

	cancel()
	sessions.StopSession()
	if err := ipcClient.ReportStatus("stopped", map[string]interface{}{"reason": "shutdown"}); err != nil {
		slog.Warn("final status report failed", "error", err)
	}

	slog.Info("live-feed stopped")
}

func handleNotifications(ctx context.Context, ipcClient *IPCClient, sessions *SessionManager) {
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

			var msg MqttMessageNotification
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

func handleCommand(ipcClient *IPCClient, sessions *SessionManager, env MQTTEnvelope) {
	switch env.Type {
	case "start-live", "start":
		var payload struct {
			CameraName string `json:"cameraName"`
			Camera     string `json:"camera"`
		}
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			slog.Warn("invalid start-live payload", "error", err)
			_ = ipcClient.ReportError(fmt.Sprintf("invalid start-live payload: %v", err), false)
			return
		}

		cameraName := payload.CameraName
		if cameraName == "" {
			cameraName = payload.Camera
		}
		if cameraName == "" {
			slog.Warn("start-live payload missing camera name")
			_ = ipcClient.ReportError("start-live payload missing cameraName", false)
			return
		}

		if err := ipcClient.ReportStatus("starting", map[string]interface{}{"camera": cameraName}); err != nil {
			slog.Debug("status report failed", "error", err)
		}
		go sessions.StartSession(cameraName)

	case "stop-live", "stop":
		sessions.StopSession()
		if err := ipcClient.ReportStatus("idle", map[string]interface{}{}); err != nil {
			slog.Debug("status report failed", "error", err)
		}

	default:
		slog.Warn("unknown live-feed command", "type", env.Type)
	}
}

func handleWebRTCAnswer(env MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		SDP string `json:"sdp"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid SDP answer payload", "error", err)
		return
	}
	sessions.SetRemoteAnswer(payload.SDP)
}

func handleWebRTCIce(env MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		Candidate json.RawMessage `json:"candidate"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid ICE candidate payload", "error", err)
		return
	}
	sessions.AddICECandidate(payload.Candidate)
}
