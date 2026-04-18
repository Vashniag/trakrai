package ptzcontrol

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/ipc/contracts"
)

type statusPayload struct {
	ActiveCamera      string            `json:"activeCamera,omitempty"`
	Capabilities      *ptzCapabilities  `json:"capabilities,omitempty"`
	ConfiguredCameras []string          `json:"configuredCameras"`
	LastCommand       string            `json:"lastCommand,omitempty"`
	LastError         string            `json:"lastError,omitempty"`
	Position          *positionSnapshot `json:"position,omitempty"`
}

type statusResponsePayload struct {
	statusPayload
	RequestID string `json:"requestId,omitempty"`
}

type commandAckPayload struct {
	Capabilities *ptzCapabilities  `json:"capabilities,omitempty"`
	CameraName   string            `json:"cameraName"`
	Command      string            `json:"command"`
	Ok           bool              `json:"ok"`
	Position     *positionSnapshot `json:"position,omitempty"`
	RequestID    string            `json:"requestId,omitempty"`
	Velocity     *velocityCommand  `json:"velocity,omitempty"`
}

type positionResponsePayload struct {
	positionSnapshot
	RequestID string `json:"requestId,omitempty"`
}

type errorPayload struct {
	CameraName string `json:"cameraName,omitempty"`
	Command    string `json:"command"`
	Error      string `json:"error"`
	RequestID  string `json:"requestId,omitempty"`
}

type cameraCommand struct {
	CameraName string `json:"cameraName"`
	RequestID  string `json:"requestId"`
}

type moveCommand struct {
	CameraName string          `json:"cameraName"`
	RequestID  string          `json:"requestId"`
	Velocity   velocityCommand `json:"velocity"`
}

type zoomCommand struct {
	CameraName string  `json:"cameraName"`
	RequestID  string  `json:"requestId"`
	Zoom       float64 `json:"zoom"`
}

type positionCommand struct {
	CameraName string  `json:"cameraName"`
	Pan        float64 `json:"pan"`
	RequestID  string  `json:"requestId"`
	Tilt       float64 `json:"tilt"`
	Zoom       float64 `json:"zoom"`
}

type Service struct {
	cfg        *Config
	ipcClient  *ipc.Client
	log        *slog.Logger
	cameras    map[string]*cameraController
	cameraList []string
	state      statusPayload
	status     string
}

func Run(ctx context.Context, cfg *Config) error {
	service := newService(cfg)

	service.connectIPC()
	defer service.ipcClient.Close()

	if err := service.reportStatus("idle"); err != nil {
		slog.Debug("initial PTZ status report failed", "error", err)
	}

	go service.handleNotifications(ctx)

	slog.Info("trakrai ptz-control ready",
		"socket", cfg.Ipc.SocketPath,
		"cameras", strings.Join(service.cameraList, ", "),
	)

	<-ctx.Done()

	if err := service.reportStatus("stopped"); err != nil {
		slog.Debug("final PTZ status report failed", "error", err)
	}

	return nil
}

func newService(cfg *Config) *Service {
	cameraMap := make(map[string]*cameraController, len(cfg.Cameras))
	cameraNames := make([]string, 0, len(cfg.Cameras))
	for _, camera := range cfg.Cameras {
		cameraMap[strings.ToLower(camera.Name)] = newCameraController(camera, cfg.Defaults)
		cameraNames = append(cameraNames, camera.Name)
	}

	return &Service{
		cfg:        cfg,
		ipcClient:  ipc.NewClient(cfg.Ipc.SocketPath, ServiceName),
		log:        slog.With("component", ServiceName),
		cameras:    cameraMap,
		cameraList: cameraNames,
		state: statusPayload{
			ConfiguredCameras: cameraNames,
		},
		status: "registered",
	}
}

func (s *Service) connectIPC() {
	s.ipcClient.Start()
}

func (s *Service) handleNotifications(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-s.ipcClient.Notifications():
			if !ok {
				s.log.Warn("IPC notification stream closed")
				return
			}
			if notification.Method != "mqtt-message" {
				continue
			}

			var message ipc.MqttMessageNotification
			if err := json.Unmarshal(notification.Params, &message); err != nil {
				s.log.Warn("invalid MQTT IPC notification", "error", err)
				continue
			}
			s.handleCommand(ctx, message.Subtopic, message.Envelope)
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, subtopic string, env ipc.MQTTEnvelope) {
	handled, err := contracts.DispatchPtzControl(ctx, "", subtopic, env, s)
	if err != nil {
		s.publishError("", "", env.Type, err)
		return
	}
	if !handled && strings.TrimSpace(subtopic) == contracts.PtzControlGetStatusSubtopic {
		s.publishError("", "", env.Type, fmt.Errorf("unsupported PTZ command %q", env.Type))
	}
}

func (s *Service) HandleGetStatus(ctx context.Context, _ string, payload contracts.PtzControlCameraCommand) error {
	if strings.TrimSpace(payload.CameraName) != "" {
		camera, err := s.cameraByName(payload.CameraName)
		if err != nil {
			s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGetStatusMethod, err)
			return nil
		}

		position, err := camera.GetPosition(ctx)
		if err != nil {
			s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGetStatusMethod, err)
			return nil
		}

		s.state.ActiveCamera = position.CameraName
		s.state.Capabilities = position.Capabilities
		s.state.Position = position
		s.state.LastError = ""
	}

	s.state.LastCommand = contracts.PtzControlGetStatusMethod
	if err := s.publishResponse("ptz-status", statusResponsePayload{
		statusPayload: s.state,
		RequestID:     strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ status response failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleGetPosition(ctx context.Context, _ string, payload contracts.PtzControlCameraCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGetPositionMethod, err)
		return nil
	}

	position, err := camera.GetPosition(ctx)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGetPositionMethod, err)
		return nil
	}

	s.state.ActiveCamera = position.CameraName
	s.state.Capabilities = position.Capabilities
	s.state.Position = position
	s.state.LastCommand = contracts.PtzControlGetPositionMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-position", positionResponsePayload{
		positionSnapshot: *position,
		RequestID:        strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ position failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleStartMove(ctx context.Context, _ string, payload contracts.PtzControlMoveCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlStartMoveMethod, err)
		return nil
	}

	velocity := velocityCommand{
		Pan:  payload.Velocity.Pan,
		Tilt: payload.Velocity.Tilt,
		Zoom: payload.Velocity.Zoom,
	}
	if err := camera.ContinuousMove(ctx, velocity); err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlStartMoveMethod, err)
		return nil
	}

	capabilities, err := camera.Capabilities(ctx)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlStartMoveMethod, err)
		return nil
	}

	s.state.ActiveCamera = strings.TrimSpace(payload.CameraName)
	s.state.Capabilities = capabilities
	s.state.LastCommand = contracts.PtzControlStartMoveMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-command-ack", commandAckPayload{
		Capabilities: capabilities,
		CameraName:   payload.CameraName,
		Command:      contracts.PtzControlStartMoveMethod,
		Ok:           true,
		RequestID:    strings.TrimSpace(payload.RequestId),
		Velocity:     &velocity,
	}); err != nil {
		s.log.Warn("publish PTZ ack failed", "error", err)
	}
	if err := s.reportStatus("moving"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleStopMove(ctx context.Context, _ string, payload contracts.PtzControlCameraCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlStopMoveMethod, err)
		return nil
	}

	position, err := camera.Stop(ctx)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlStopMoveMethod, err)
		return nil
	}

	s.state.ActiveCamera = position.CameraName
	s.state.Capabilities = position.Capabilities
	s.state.Position = position
	s.state.LastCommand = contracts.PtzControlStopMoveMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-command-ack", commandAckPayload{
		Capabilities: position.Capabilities,
		CameraName:   payload.CameraName,
		Command:      contracts.PtzControlStopMoveMethod,
		Ok:           true,
		Position:     position,
		RequestID:    strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ stop ack failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleSetZoom(ctx context.Context, _ string, payload contracts.PtzControlZoomCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlSetZoomMethod, err)
		return nil
	}

	position, err := camera.SetZoom(ctx, payload.Zoom)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlSetZoomMethod, err)
		return nil
	}

	s.state.ActiveCamera = position.CameraName
	s.state.Capabilities = position.Capabilities
	s.state.Position = position
	s.state.LastCommand = contracts.PtzControlSetZoomMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-command-ack", commandAckPayload{
		Capabilities: position.Capabilities,
		CameraName:   payload.CameraName,
		Command:      contracts.PtzControlSetZoomMethod,
		Ok:           true,
		Position:     position,
		RequestID:    strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ zoom ack failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleGoHome(ctx context.Context, _ string, payload contracts.PtzControlCameraCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGoHomeMethod, err)
		return nil
	}

	position, err := camera.GoHome(ctx)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlGoHomeMethod, err)
		return nil
	}

	s.state.ActiveCamera = position.CameraName
	s.state.Capabilities = position.Capabilities
	s.state.Position = position
	s.state.LastCommand = contracts.PtzControlGoHomeMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-command-ack", commandAckPayload{
		Capabilities: position.Capabilities,
		CameraName:   payload.CameraName,
		Command:      contracts.PtzControlGoHomeMethod,
		Ok:           true,
		Position:     position,
		RequestID:    strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ home ack failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) HandleSetPosition(ctx context.Context, _ string, payload contracts.PtzControlPositionCommand) error {
	camera, err := s.cameraByName(payload.CameraName)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlSetPositionMethod, err)
		return nil
	}

	position, err := camera.SetPosition(ctx, payload.Pan, payload.Tilt, payload.Zoom)
	if err != nil {
		s.publishError(strings.TrimSpace(payload.RequestId), payload.CameraName, contracts.PtzControlSetPositionMethod, err)
		return nil
	}

	s.state.ActiveCamera = position.CameraName
	s.state.Capabilities = position.Capabilities
	s.state.Position = position
	s.state.LastCommand = contracts.PtzControlSetPositionMethod
	s.state.LastError = ""

	if err := s.publishResponse("ptz-command-ack", commandAckPayload{
		Capabilities: position.Capabilities,
		CameraName:   payload.CameraName,
		Command:      contracts.PtzControlSetPositionMethod,
		Ok:           true,
		Position:     position,
		RequestID:    strings.TrimSpace(payload.RequestId),
	}); err != nil {
		s.log.Warn("publish PTZ absolute move ack failed", "error", err)
	}
	if err := s.reportStatus("idle"); err != nil {
		s.log.Debug("PTZ status report failed", "error", err)
	}
	return nil
}

func (s *Service) cameraByName(name string) (*cameraController, error) {
	cameraName := strings.TrimSpace(name)
	if cameraName == "" && len(s.cameraList) > 0 {
		cameraName = s.cameraList[0]
	}

	camera := s.cameras[strings.ToLower(cameraName)]
	if camera == nil {
		return nil, fmt.Errorf("camera %q is not configured for PTZ.", cameraName)
	}

	return camera, nil
}

func (s *Service) publishResponse(msgType string, payload interface{}) error {
	return s.ipcClient.Publish("response", msgType, payload)
}

func (s *Service) publishError(requestID string, cameraName string, command string, err error) {
	s.state.LastCommand = command
	s.state.LastError = err.Error()
	if strings.TrimSpace(cameraName) != "" {
		s.state.ActiveCamera = strings.TrimSpace(cameraName)
	}

	if publishErr := s.publishResponse("ptz-error", errorPayload{
		CameraName: strings.TrimSpace(cameraName),
		Command:    command,
		Error:      err.Error(),
		RequestID:  strings.TrimSpace(requestID),
	}); publishErr != nil {
		s.log.Warn("publish PTZ error failed", "error", publishErr)
	}

	if reportErr := s.ipcClient.ReportError(err.Error(), false); reportErr != nil {
		s.log.Debug("PTZ error report failed", "error", reportErr)
	}
	if reportErr := s.reportStatus("error"); reportErr != nil {
		s.log.Debug("PTZ status report failed", "error", reportErr)
	}
}

func (s *Service) reportStatus(status string) error {
	s.status = status
	return s.ipcClient.ReportStatus(status, statusDetailsMap(s.state))
}

func statusDetailsMap(payload statusPayload) map[string]interface{} {
	data, _ := json.Marshal(payload)
	var details map[string]interface{}
	_ = json.Unmarshal(data, &details)
	return details
}
