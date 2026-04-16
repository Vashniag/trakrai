package audioalert

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type Service struct {
	cfg       *Config
	ipcClient *ipc.Client

	mu    sync.Mutex
	state state
}

type commandResult struct {
	CallbackPayload map[string]interface{}
	CallbackType    string
	Details         map[string]interface{}
	Status          string
}

func Run(ctx context.Context, cfg *Config) error {
	slog.Info("trakrai audio-alert starting", "socket", cfg.IPC.SocketPath)

	service := &Service{
		cfg:       cfg,
		ipcClient: ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		state:     newState(cfg),
	}
	service.ipcClient.Start()
	defer service.ipcClient.Close()

	if err := service.ipcClient.ReportStatus("idle", service.statusDetails()); err != nil {
		slog.Debug("initial status report failed", "error", err)
	}

	ticker := time.NewTicker(time.Duration(cfg.Queue.TickIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			if err := service.ipcClient.ReportStatus("stopped", map[string]interface{}{"reason": "shutdown"}); err != nil {
				slog.Debug("final status report failed", "error", err)
			}
			return nil
		case notification, ok := <-service.ipcClient.Notifications():
			if !ok {
				return nil
			}
			if err := service.handleNotification(notification); err != nil {
				slog.Warn("audio-alert notification failed", "error", err)
				if reportErr := service.ipcClient.ReportError(err.Error(), false); reportErr != nil {
					slog.Debug("error report failed", "error", reportErr)
				}
			}
		case <-ticker.C:
			if changed := service.advanceQueue(time.Now().UTC()); changed {
				if err := service.ipcClient.ReportStatus(service.playbackStatus(), service.statusDetails()); err != nil {
					slog.Debug("periodic status report failed", "error", err)
				}
			}
		}
	}
}

func (s *Service) handleNotification(notification ipc.Notification) error {
	switch notification.Method {
	case "service-message":
		var message ipc.ServiceMessageNotification
		if err := json.Unmarshal(notification.Params, &message); err != nil {
			return fmt.Errorf("decode service-message: %w", err)
		}
		return s.handleCommand(message.SourceService, message.Subtopic, message.Envelope)
	case "mqtt-message":
		var message ipc.MqttMessageNotification
		if err := json.Unmarshal(notification.Params, &message); err != nil {
			return fmt.Errorf("decode mqtt-message: %w", err)
		}
		return s.handleCommand(message.Service, message.Subtopic, message.Envelope)
	default:
		return nil
	}
}

func (s *Service) handleCommand(sourceService string, subtopic string, envelope ipc.MQTTEnvelope) error {
	if subtopic != "command" {
		return nil
	}

	var command Command
	if len(envelope.Payload) > 0 {
		if err := json.Unmarshal(envelope.Payload, &command); err != nil {
			return fmt.Errorf("decode audio command: %w", err)
		}
	}

	normalized, err := normalizeCommand(envelope.Type, command, s.cfg)
	if err != nil {
		return err
	}

	result, err := s.applyCommand(envelope.Type, normalized, time.Now().UTC())
	if err != nil {
		return err
	}

	details := s.statusDetails()
	details["source_service"] = sourceService
	details["subtopic"] = subtopic
	for key, value := range result.Details {
		details[key] = value
	}

	if err := s.ipcClient.ReportStatus(result.Status, details); err != nil {
		return err
	}

	if normalized.ReplyTo != nil {
		return s.ipcClient.SendServiceMessage(
			normalized.ReplyTo.Service,
			normalized.ReplyTo.Subtopic,
			result.CallbackType,
			result.CallbackPayload,
		)
	}

	return nil
}

func newState(cfg *Config) state {
	return state{
		ActiveTalkbacks: make(map[string]talkbackSession),
		CurrentVolume:   cfg.Playback.DefaultVolume,
	}
}

func (s *Service) applyCommand(commandType string, command Command, now time.Time) (*commandResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.advanceQueueLocked(now)
	s.state.LastCommand = commandType
	s.state.LastRequestID = command.RequestID
	s.state.LastUpdatedAt = now.Format(time.RFC3339Nano)

	switch commandType {
	case CommandPlayAlert:
		return s.applyPlayAlertLocked(command, now)
	case CommandStopAlert:
		return s.applyStopAlertLocked(command, now), nil
	case CommandSetVolume:
		s.state.CurrentVolume = command.Volume
		if s.state.ActiveAlert != nil {
			s.state.ActiveAlert.Volume = command.Volume
		}
		return s.buildResultLocked("accepted", "audio-alert.accepted", command, map[string]interface{}{
			"queue_depth": len(s.state.PendingAlerts),
		}), nil
	case CommandStartTalkback:
		return s.applyStartTalkbackLocked(command, now)
	case CommandStopTalkback:
		delete(s.state.ActiveTalkbacks, command.SessionID)
		return s.buildResultLocked("accepted", "audio-alert.accepted", command, map[string]interface{}{
			"queue_depth": len(s.state.PendingAlerts),
			"session_id":  command.SessionID,
		}), nil
	default:
		return nil, fmt.Errorf("unsupported audio command %q", commandType)
	}
}

func (s *Service) applyPlayAlertLocked(command Command, now time.Time) (*commandResult, error) {
	if !s.cfg.Playback.Enabled {
		return nil, fmt.Errorf("playback is disabled")
	}

	alert := alertRequest{
		EnqueuedAt: now,
		Message:    command.Message,
		Priority:   command.Priority,
		RequestID:  command.RequestID,
		Speaker:    command.Speaker,
		Volume:     command.Volume,
	}

	if s.state.ActiveAlert == nil {
		s.startAlertLocked(alert, now)
		return s.buildResultLocked("accepted", "audio-alert.accepted", command, map[string]interface{}{
			"queue_depth": len(s.state.PendingAlerts),
		}), nil
	}

	if len(s.state.PendingAlerts) >= s.cfg.Queue.MaxPendingAlerts {
		return nil, fmt.Errorf("alert queue capacity reached")
	}

	s.state.PendingAlerts = append(s.state.PendingAlerts, alert)
	return s.buildResultLocked("queued", "audio-alert.queued", command, map[string]interface{}{
		"active_alert_id": s.state.ActiveAlert.RequestID,
		"queue_depth":     len(s.state.PendingAlerts),
	}), nil
}

func (s *Service) applyStopAlertLocked(command Command, now time.Time) *commandResult {
	status := "idle"
	stoppedRequestID := ""

	if s.state.ActiveAlert != nil {
		stoppedRequestID = s.state.ActiveAlert.RequestID
		s.completeActiveAlertLocked()
		if s.promoteNextAlertLocked(now) {
			status = "accepted"
		}
	} else if len(s.state.PendingAlerts) > 0 {
		stoppedRequestID = s.state.PendingAlerts[0].RequestID
		s.state.PendingAlerts = append([]alertRequest(nil), s.state.PendingAlerts[1:]...)
	}

	return s.buildResultLocked(status, "audio-alert.stopped", command, map[string]interface{}{
		"queue_depth":        len(s.state.PendingAlerts),
		"stopped_request_id": stoppedRequestID,
	})
}

func (s *Service) applyStartTalkbackLocked(command Command, now time.Time) (*commandResult, error) {
	if !s.cfg.Talkback.Enabled {
		return nil, fmt.Errorf("talkback is disabled")
	}
	if _, exists := s.state.ActiveTalkbacks[command.SessionID]; !exists && len(s.state.ActiveTalkbacks) >= s.cfg.Talkback.MaxSessions {
		return nil, fmt.Errorf("talkback capacity reached")
	}

	s.state.ActiveTalkbacks[command.SessionID] = talkbackSession{
		Metadata:  cloneMap(command.Metadata),
		SessionID: command.SessionID,
		StartedAt: now,
		State:     "active",
		Transport: s.talkbackMode(),
	}
	return s.buildResultLocked("accepted", "audio-alert.accepted", command, map[string]interface{}{
		"queue_depth":        len(s.state.PendingAlerts),
		"session_id":         command.SessionID,
		"talkback_transport": s.talkbackMode(),
		"webrtc_enabled":     s.cfg.Talkback.WebRTC.Enabled,
	}), nil
}

func (s *Service) startAlertLocked(alert alertRequest, now time.Time) {
	alert.StartedAt = now
	alert.FinishAt = now.Add(time.Duration(s.cfg.Queue.SimulatedPlaybackMs) * time.Millisecond)
	s.state.ActiveAlert = &alert
	s.state.CurrentVolume = alert.Volume
}

func (s *Service) completeActiveAlertLocked() {
	if s.state.ActiveAlert == nil {
		return
	}
	s.state.CompletedAlerts++
	s.state.LastCompletedRequestID = s.state.ActiveAlert.RequestID
	s.state.ActiveAlert = nil
}

func (s *Service) promoteNextAlertLocked(now time.Time) bool {
	if len(s.state.PendingAlerts) == 0 {
		return false
	}

	next := s.state.PendingAlerts[0]
	s.state.PendingAlerts = append([]alertRequest(nil), s.state.PendingAlerts[1:]...)
	s.startAlertLocked(next, now)
	return true
}

func (s *Service) advanceQueue(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.advanceQueueLocked(now)
}

func (s *Service) advanceQueueLocked(now time.Time) bool {
	if s.state.ActiveAlert == nil {
		return false
	}
	if now.Before(s.state.ActiveAlert.FinishAt) {
		return false
	}

	s.completeActiveAlertLocked()
	return s.promoteNextAlertLocked(now) || s.state.LastCompletedRequestID != ""
}

func (s *Service) buildResultLocked(status string, callbackType string, command Command, extra map[string]interface{}) *commandResult {
	payload := map[string]interface{}{
		"active_talkbacks":   len(s.state.ActiveTalkbacks),
		"current_volume":     s.state.CurrentVolume,
		"playback_mode":      "queued-stub",
		"queued_alerts":      len(s.state.PendingAlerts),
		"request_id":         command.RequestID,
		"talkback_mode":      s.talkbackMode(),
		"talkback_transport": s.cfg.Talkback.Transport,
	}
	if s.state.ActiveAlert != nil {
		payload["active_alert_request_id"] = s.state.ActiveAlert.RequestID
	}
	for key, value := range extra {
		payload[key] = value
	}

	return &commandResult{
		CallbackPayload: payload,
		CallbackType:    callbackType,
		Details:         cloneMap(extra),
		Status:          status,
	}
}

func (s *Service) playbackStatus() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.state.ActiveAlert != nil {
		return "playing"
	}
	if len(s.state.PendingAlerts) > 0 {
		return "queued"
	}
	return "idle"
}

func (s *Service) statusDetails() map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()

	details := map[string]interface{}{
		"active_talkbacks":       len(s.state.ActiveTalkbacks),
		"completed_alerts":       s.state.CompletedAlerts,
		"current_volume":         s.state.CurrentVolume,
		"default_volume":         s.cfg.Playback.DefaultVolume,
		"last_command":           s.state.LastCommand,
		"last_request_id":        s.state.LastRequestID,
		"last_updated_at":        s.state.LastUpdatedAt,
		"max_queued_alerts":      s.cfg.Queue.MaxPendingAlerts,
		"playback_mode":          "queued-stub",
		"playback_ready":         s.cfg.Playback.Enabled,
		"playback_state":         "idle",
		"queued_alerts":          len(s.state.PendingAlerts),
		"simulated_playback_ms":  s.cfg.Queue.SimulatedPlaybackMs,
		"speaker_device":         s.cfg.Playback.SpeakerDevice,
		"talkback_mode":          s.talkbackMode(),
		"talkback_ready":         s.cfg.Talkback.Enabled,
		"talkback_transport":     s.cfg.Talkback.Transport,
		"webrtc_enabled":         s.cfg.Talkback.WebRTC.Enabled,
		"webrtc_signalling_mode": s.cfg.Talkback.WebRTC.SignallingMode,
	}
	if s.state.ActiveAlert != nil {
		details["active_alert_finish_at"] = s.state.ActiveAlert.FinishAt.Format(time.RFC3339Nano)
		details["active_alert_message"] = s.state.ActiveAlert.Message
		details["active_alert_request_id"] = s.state.ActiveAlert.RequestID
		details["active_alert_started_at"] = s.state.ActiveAlert.StartedAt.Format(time.RFC3339Nano)
		details["playback_state"] = "playing"
	}
	if len(s.state.PendingAlerts) > 0 {
		details["next_alert_request_id"] = s.state.PendingAlerts[0].RequestID
	}
	if s.state.LastCompletedRequestID != "" {
		details["last_completed_request_id"] = s.state.LastCompletedRequestID
	}
	return details
}

func (s *Service) talkbackMode() string {
	if s.cfg.Talkback.WebRTC.Enabled {
		return "webrtc-stub"
	}
	return "stub"
}

func cloneMap(input map[string]interface{}) map[string]interface{} {
	if len(input) == 0 {
		return map[string]interface{}{}
	}
	cloned := make(map[string]interface{}, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
