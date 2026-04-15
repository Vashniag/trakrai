package roiconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

const (
	roiConfigDocumentType = "roi-config-document"
	roiConfigErrorType    = "roi-config-error"
	roiConfigStatusType   = "roi-config-status"
)

type Service struct {
	cfg       *Config
	ipcClient *ipc.Client
	log       *slog.Logger
}

func NewService(cfg *Config) *Service {
	return &Service{
		cfg:       cfg,
		ipcClient: ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		log:       slog.With("component", ServiceName),
	}
}

func (s *Service) Close() {
	s.ipcClient.Close()
}

func (s *Service) Run(ctx context.Context) error {
	document, err := ensureDocument(s.cfg.Storage.FilePath)
	if err != nil {
		return fmt.Errorf("initialize ROI document: %w", err)
	}

	s.ipcClient.Start()
	if err := s.reportStatus("running", document); err != nil {
		s.log.Debug("initial ROI status report failed", "error", err)
	}

	go s.handleNotifications(ctx)

	s.log.Info(
		"roi-config ready",
		"file_path", s.cfg.Storage.FilePath,
		"camera_count", len(document.Cameras),
	)

	<-ctx.Done()
	if err := s.reportStatus("stopped", document); err != nil {
		s.log.Debug("final ROI status report failed", "error", err)
	}
	return nil
}

func (s *Service) handleNotifications(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-s.ipcClient.Notifications():
			if !ok {
				return
			}

			switch notification.Method {
			case "mqtt-message":
				var message ipc.MqttMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid ROI MQTT notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) != "command" {
					continue
				}
				s.handleCommand(ctx, "", message.Envelope)
			case "service-message":
				var message ipc.ServiceMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid ROI service notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) != "command" {
					continue
				}
				s.handleCommand(ctx, message.SourceService, message.Envelope)
			}
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, targetService string, env ipc.MQTTEnvelope) {
	switch strings.TrimSpace(env.Type) {
	case "get-status":
		s.handleGetStatus(ctx, targetService, env)
	case "get-config":
		s.handleGetConfig(ctx, targetService, env)
	case "save-config":
		s.handleSaveConfig(ctx, targetService, env)
	default:
		s.publishError(targetService, "", env.Type, fmt.Errorf("unsupported ROI command %q", env.Type))
	}
}

func (s *Service) handleGetStatus(ctx context.Context, targetService string, env ipc.MQTTEnvelope) {
	var request requestEnvelope
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &request); err != nil {
			s.publishError(targetService, "", env.Type, fmt.Errorf("invalid get-status payload: %w", err))
			return
		}
	}

	document, err := loadDocument(s.cfg.Storage.FilePath)
	if err != nil {
		s.publishError(targetService, request.RequestID, env.Type, err)
		return
	}

	status := documentStatus(s.cfg.Storage.FilePath, document)
	if err := s.publishReply(targetService, roiConfigStatusType, struct {
		RequestID string `json:"requestId,omitempty"`
		StatusPayload
	}{
		RequestID:     strings.TrimSpace(request.RequestID),
		StatusPayload: status,
	}); err != nil {
		s.log.Warn("publish ROI status failed", "error", err)
	}
	if err := s.reportStatus("running", document); err != nil {
		s.log.Debug("ROI status report failed", "error", err)
	}
	_ = ctx
}

func (s *Service) handleGetConfig(ctx context.Context, targetService string, env ipc.MQTTEnvelope) {
	var request requestEnvelope
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &request); err != nil {
			s.publishError(targetService, "", env.Type, fmt.Errorf("invalid get-config payload: %w", err))
			return
		}
	}

	document, err := loadDocument(s.cfg.Storage.FilePath)
	if err != nil {
		s.publishError(targetService, request.RequestID, env.Type, err)
		return
	}

	if err := s.publishDocument(targetService, strings.TrimSpace(request.RequestID), document); err != nil {
		s.log.Warn("publish ROI document failed", "error", err)
	}
	if err := s.reportStatus("running", document); err != nil {
		s.log.Debug("ROI status report failed", "error", err)
	}
	_ = ctx
}

func (s *Service) handleSaveConfig(ctx context.Context, targetService string, env ipc.MQTTEnvelope) {
	var request saveConfigRequest
	if err := json.Unmarshal(env.Payload, &request); err != nil {
		s.publishError(targetService, "", env.Type, fmt.Errorf("invalid save-config payload: %w", err))
		return
	}

	if err := saveDocument(s.cfg.Storage.FilePath, request.Document, time.Now().UTC()); err != nil {
		s.publishError(targetService, request.RequestID, env.Type, err)
		return
	}

	document, err := loadDocument(s.cfg.Storage.FilePath)
	if err != nil {
		s.publishError(targetService, request.RequestID, env.Type, err)
		return
	}

	if err := s.publishDocument(targetService, strings.TrimSpace(request.RequestID), document); err != nil {
		s.log.Warn("publish saved ROI document failed", "error", err)
	}
	if err := s.reportStatus("running", document); err != nil {
		s.log.Debug("ROI status report failed", "error", err)
	}
	_ = ctx
}

func (s *Service) publishDocument(targetService string, requestID string, document Document) error {
	status := documentStatus(s.cfg.Storage.FilePath, document)
	return s.publishReply(targetService, roiConfigDocumentType, getConfigPayload{
		Document:      document,
		FilePath:      s.cfg.Storage.FilePath,
		RequestID:     requestID,
		StatusPayload: status,
	})
}

func (s *Service) publishReply(targetService string, messageType string, payload interface{}) error {
	targetService = strings.TrimSpace(targetService)
	if targetService != "" {
		return s.ipcClient.SendServiceMessage(targetService, "response", messageType, payload)
	}
	return s.ipcClient.Publish("response", messageType, payload)
}

func (s *Service) publishError(targetService string, requestID string, requestType string, err error) {
	if err == nil {
		return
	}
	payload := errorPayload{
		Error:       err.Error(),
		RequestID:   strings.TrimSpace(requestID),
		RequestType: strings.TrimSpace(requestType),
	}
	if publishErr := s.publishReply(targetService, roiConfigErrorType, payload); publishErr != nil {
		s.log.Warn("publish ROI error failed", "error", publishErr)
	}
	if reportErr := s.ipcClient.ReportError(payload.Error, false); reportErr != nil {
		s.log.Debug("ROI error report failed", "error", reportErr)
	}
}

func (s *Service) reportStatus(status string, document Document) error {
	summary := documentStatus(s.cfg.Storage.FilePath, document)
	return s.ipcClient.ReportStatus(status, map[string]interface{}{
		"baseLocationCount": summary.BaseLocationCount,
		"cameraCount":       summary.CameraCount,
		"documentHash":      summary.DocumentHash,
		"filePath":          summary.FilePath,
		"roiBoxCount":       summary.ROIBoxCount,
		"updatedAt":         summary.UpdatedAt,
	})
}
