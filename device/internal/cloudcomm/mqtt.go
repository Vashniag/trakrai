package cloudcomm

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/trakrai/device-services/internal/ipc"
)

type topicRoute struct {
	service  string
	subtopic string
}

type MQTTService struct {
	client    mqtt.Client
	cfg       *Config
	log       *slog.Logger
	ipcServer *ipc.Server
	startedAt time.Time
}

func NewMQTTService(cfg *Config, ipcServer *ipc.Server, startedAt time.Time) *MQTTService {
	return &MQTTService{
		cfg:       cfg,
		log:       slog.With("component", "mqtt"),
		ipcServer: ipcServer,
		startedAt: startedAt,
	}
}

func (m *MQTTService) topicPrefix() string {
	return fmt.Sprintf("trakrai/device/%s", m.cfg.DeviceID)
}

func (m *MQTTService) Connect() error {
	opts := mqtt.NewClientOptions().
		AddBroker(m.cfg.MQTT.BrokerURL).
		SetClientID(m.cfg.MQTT.ClientID).
		SetKeepAlive(time.Duration(m.cfg.MQTT.KeepAliveSec) * time.Second).
		SetCleanSession(true).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(30 * time.Second).
		SetOnConnectHandler(func(_ mqtt.Client) {
			m.log.Info("connected to broker")
			m.subscribe()
		}).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			m.log.Warn("connection lost", "error", err)
		})

	m.client = mqtt.NewClient(opts)
	token := m.client.Connect()
	token.Wait()
	if err := token.Error(); err != nil {
		return fmt.Errorf("mqtt connect: %w", err)
	}
	return nil
}

func (m *MQTTService) subscribe() {
	prefix := m.topicPrefix()
	topics := map[string]byte{
		prefix + "/command":                 1,
		prefix + "/webrtc/answer":           1,
		prefix + "/webrtc/ice":              1,
		prefix + "/service/+/command":       1,
		prefix + "/service/+/webrtc/answer": 1,
		prefix + "/service/+/webrtc/ice":    1,
	}
	token := m.client.SubscribeMultiple(topics, m.handleMessage)
	token.Wait()
	if err := token.Error(); err != nil {
		m.log.Error("subscribe failed", "error", err)
	} else {
		m.log.Info("subscribed to MQTT command topics")
	}
}

func (m *MQTTService) handleMessage(_ mqtt.Client, msg mqtt.Message) {
	var env ipc.MQTTEnvelope
	if err := json.Unmarshal(msg.Payload(), &env); err != nil {
		m.log.Error("invalid message", "topic", msg.Topic(), "error", err)
		return
	}

	m.log.Debug("received", "topic", msg.Topic(), "type", env.Type)

	route, ok := m.routeTopic(msg.Topic())
	if !ok {
		m.log.Debug("ignoring unknown topic", "topic", msg.Topic())
		return
	}

	if route.service == "live-feed" && route.subtopic == "command" && env.Type == "get-status" {
		if err := m.publishStatusResponse(); err != nil {
			m.log.Warn("publish status response failed", "error", err)
		}
		return
	}

	if err := m.ipcServer.NotifyService(route.service, ipc.MqttMessageNotification{
		Service:  route.service,
		Subtopic: route.subtopic,
		Envelope: env,
	}); err != nil {
		m.log.Warn("IPC notify failed", "service", route.service, "subtopic", route.subtopic, "error", err)
		if route.subtopic == "command" {
			if publishErr := m.publishServiceUnavailable(route.service, env.Type, err); publishErr != nil {
				m.log.Warn("publish service unavailable failed", "service", route.service, "error", publishErr)
			}
		}
	}
}

func (m *MQTTService) routeTopic(topic string) (topicRoute, bool) {
	prefix := m.topicPrefix()
	switch topic {
	case prefix + "/command":
		return topicRoute{service: "live-feed", subtopic: "command"}, true
	case prefix + "/webrtc/answer":
		return topicRoute{service: "live-feed", subtopic: "webrtc/answer"}, true
	case prefix + "/webrtc/ice":
		return topicRoute{service: "live-feed", subtopic: "webrtc/ice"}, true
	}

	servicePrefix := prefix + "/service/"
	if !strings.HasPrefix(topic, servicePrefix) {
		return topicRoute{}, false
	}

	rest := strings.TrimPrefix(topic, servicePrefix)
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		return topicRoute{}, false
	}

	return topicRoute{
		service:  parts[0],
		subtopic: strings.Join(parts[1:], "/"),
	}, true
}

func marshalPayload(payload interface{}) json.RawMessage {
	data, _ := json.Marshal(payload)
	return data
}

func (m *MQTTService) publishServiceUnavailable(service string, requestType string, notifyErr error) error {
	return m.Publish(ipc.PublishMessageRequest{
		Service:  service,
		Subtopic: "response",
		Type:     "service-unavailable",
		Payload: marshalPayload(map[string]interface{}{
			"service":     service,
			"requestType": requestType,
			"error":       notifyErr.Error(),
		}),
	})
}

func (m *MQTTService) publishStatusResponse() error {
	return m.Publish(ipc.PublishMessageRequest{
		Subtopic: "response",
		Type:     "status",
		Payload: marshalPayload(map[string]interface{}{
			"uptime":   time.Since(m.startedAt).Seconds(),
			"deviceId": m.cfg.DeviceID,
			"cameras":  m.cfg.Cameras,
			"services": m.ipcServer.GetStatuses(),
		}),
	})
}

func (m *MQTTService) heartbeatPayload() json.RawMessage {
	return marshalPayload(map[string]interface{}{
		"uptime":    time.Since(m.startedAt).Seconds(),
		"device_id": m.cfg.DeviceID,
		"cameras":   m.cfg.Cameras,
		"services":  m.ipcServer.GetStatuses(),
	})
}

func (m *MQTTService) Publish(req ipc.PublishMessageRequest) error {
	if req.Subtopic == "" || req.Type == "" {
		return fmt.Errorf("subtopic and type are required")
	}

	env := ipc.MQTTEnvelope{
		MsgID:     fmt.Sprintf("%d", time.Now().UnixNano()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Type:      req.Type,
		Payload:   req.Payload,
	}
	if len(env.Payload) == 0 {
		env.Payload = marshalPayload(map[string]interface{}{})
	}

	envData, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	topic := m.publishTopic(req)
	token := m.client.Publish(topic, 1, false, envData)
	token.Wait()
	if err := token.Error(); err != nil {
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	return nil
}

func (m *MQTTService) publishTopic(req ipc.PublishMessageRequest) string {
	subtopic := strings.TrimPrefix(req.Subtopic, "/")
	if req.Service == "" || req.Service == "live-feed" {
		return m.topicPrefix() + "/" + subtopic
	}

	return fmt.Sprintf("%s/service/%s/%s", m.topicPrefix(), req.Service, subtopic)
}

func (m *MQTTService) StartHeartbeat(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.Publish(ipc.PublishMessageRequest{
				Subtopic: "status",
				Type:     "heartbeat",
				Payload:  m.heartbeatPayload(),
			}); err != nil {
				m.log.Warn("heartbeat publish failed", "error", err)
			}
		}
	}
}

func (m *MQTTService) Disconnect() {
	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(1000)
	}
}
