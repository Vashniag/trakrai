package livefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/ipc/contracts"
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

type liveFeedCommandHandler struct {
	ipcClient *ipc.Client
	sessions  *SessionManager
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
	handler := liveFeedCommandHandler{
		ipcClient: ipcClient,
		sessions:  sessions,
	}
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

			handled, err := contracts.DispatchLiveFeed(ctx, "", msg.Subtopic, msg.Envelope, handler)
			if err != nil {
				slog.Warn("live-feed notification handling failed", "subtopic", msg.Subtopic, "type", msg.Envelope.Type, "error", err)
				_ = ipcClient.ReportError(err.Error(), false)
				continue
			}
			if !handled {
				slog.Debug("ignoring IPC notification", "subtopic", msg.Subtopic)
			}
		}
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

func (h liveFeedCommandHandler) HandleStartLive(_ context.Context, _ string, request contracts.LiveFeedLiveLayoutRequest) error {
	payload := liveLayoutPayload{
		Camera:      request.Camera,
		CameraName:  request.CameraName,
		CameraNames: request.CameraNames,
		FrameSource: request.FrameSource,
		LayoutMode:  request.LayoutMode,
		RequestID:   request.RequestId,
		SessionID:   request.SessionId,
	}
	plan, err := layoutPlanFromPayload(payload)
	if err != nil {
		return fmt.Errorf("invalid start-live payload: %w", err)
	}
	if err := h.ipcClient.ReportStatus("starting", mergeLayoutDetails(plan, map[string]interface{}{
		"camera": plan.PrimaryCamera(),
	})); err != nil {
		slog.Debug("status report failed", "error", err)
	}
	go h.sessions.StartSession(plan, payload.RequestID)
	return nil
}

func (h liveFeedCommandHandler) HandleUpdateLiveLayout(_ context.Context, _ string, request contracts.LiveFeedLiveLayoutRequest) error {
	payload := liveLayoutPayload{
		Camera:      request.Camera,
		CameraName:  request.CameraName,
		CameraNames: request.CameraNames,
		FrameSource: request.FrameSource,
		LayoutMode:  request.LayoutMode,
		RequestID:   request.RequestId,
		SessionID:   request.SessionId,
	}
	plan, err := layoutPlanFromPayload(payload)
	if err != nil {
		return fmt.Errorf("invalid update-live-layout payload: %w", err)
	}
	if err := h.sessions.UpdateSessionLayout(payload.SessionID, payload.RequestID, plan); err != nil {
		return fmt.Errorf("update-live-layout failed: %w", err)
	}
	return nil
}

func (h liveFeedCommandHandler) HandleStopLive(_ context.Context, _ string, request contracts.LiveFeedStopLiveRequest) error {
	switch {
	case strings.TrimSpace(request.SessionId) != "":
		h.sessions.StopSession(request.SessionId)
	case strings.TrimSpace(request.RequestId) != "":
		h.sessions.StopSessionByRequestID(request.RequestId)
	default:
		h.sessions.StopSession("")
	}
	return nil
}

func (h liveFeedCommandHandler) HandleSdpAnswer(_ context.Context, _ string, request contracts.LiveFeedSdpAnswerRequest) error {
	h.sessions.SetRemoteAnswer(request.SessionId, request.Sdp)
	return nil
}

func (h liveFeedCommandHandler) HandleIceCandidate(_ context.Context, _ string, request contracts.LiveFeedIceCandidateRequest) error {
	candidate, err := json.Marshal(request.Candidate)
	if err != nil {
		return fmt.Errorf("encode ICE candidate: %w", err)
	}
	h.sessions.AddICECandidate(request.SessionId, candidate)
	return nil
}
