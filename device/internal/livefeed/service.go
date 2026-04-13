package livefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

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
	if err := ipcClient.Connect(); err != nil {
		return err
	}
	defer ipcClient.Close()

	if err := ipcClient.ReportStatus("running", map[string]interface{}{
		"redis": redisconfig.Address(cfg.Redis),
	}); err != nil {
		slog.Warn("initial status report failed", "error", err)
	}

	sessions := NewSessionManager(cfg, frameSource, ipcClient)
	go handleNotifications(ctx, ipcClient, sessions)

	slog.Info("live-feed ready, waiting for IPC notifications")
	<-ctx.Done()

	sessions.StopSession()
	if err := ipcClient.ReportStatus("stopped", map[string]interface{}{"reason": "shutdown"}); err != nil {
		slog.Warn("final status report failed", "error", err)
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

func handleWebRTCAnswer(env ipc.MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		SDP string `json:"sdp"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid SDP answer payload", "error", err)
		return
	}
	sessions.SetRemoteAnswer(payload.SDP)
}

func handleWebRTCIce(env ipc.MQTTEnvelope, sessions *SessionManager) {
	var payload struct {
		Candidate json.RawMessage `json:"candidate"`
	}
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		slog.Warn("invalid ICE candidate payload", "error", err)
		return
	}
	sessions.AddICECandidate(payload.Candidate)
}
