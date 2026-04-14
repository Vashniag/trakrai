package cloudcomm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/trakrai/device-services/internal/ipc"
)

type topicRoute struct {
	service  string
	subtopic string
}

const (
	mqttReconnectInitialDelay = 2 * time.Second
	mqttReconnectMaxDelay     = 30 * time.Second
	mqttConnectTimeout        = 10 * time.Second
	mqttWaitForReadyTimeout   = time.Second
)

var errMQTTUnavailable = errors.New("MQTT client is unavailable")

type MQTTService struct {
	cfg       *Config
	log       *slog.Logger
	ipcServer *ipc.Server
	startedAt time.Time
	inbound   func(route topicRoute, env ipc.MQTTEnvelope) error

	clientMu         sync.RWMutex
	client           mqtt.Client
	clientGeneration uint64
	readyCh          chan struct{}

	reconnectMu  sync.Mutex
	reconnecting bool

	startOnce sync.Once
	closeOnce sync.Once
	closedCh  chan struct{}
}

func NewMQTTService(
	cfg *Config,
	ipcServer *ipc.Server,
	startedAt time.Time,
	inbound func(route topicRoute, env ipc.MQTTEnvelope) error,
) *MQTTService {
	return &MQTTService{
		cfg:       cfg,
		log:       slog.With("component", "mqtt"),
		ipcServer: ipcServer,
		startedAt: startedAt,
		inbound:   inbound,
		readyCh:   make(chan struct{}),
		closedCh:  make(chan struct{}),
	}
}

func (m *MQTTService) topicPrefix() string {
	return fmt.Sprintf("trakrai/device/%s", m.cfg.DeviceID)
}

func (m *MQTTService) Start() {
	m.startOnce.Do(func() {
		m.ensureReconnectLoop()
	})
}

func (m *MQTTService) subscribe(client mqtt.Client) error {
	prefix := m.topicPrefix()
	topics := map[string]byte{
		prefix + "/command":                 1,
		prefix + "/service/+/command":       1,
		prefix + "/service/+/webrtc/answer": 1,
		prefix + "/service/+/webrtc/ice":    1,
	}
	token := client.SubscribeMultiple(topics, m.handleMessage)
	token.Wait()
	if err := token.Error(); err != nil {
		return err
	}
	m.log.Info("subscribed to MQTT command topics")
	return nil
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

	if err := m.inbound(route, env); err != nil {
		m.log.Warn("MQTT inbound dispatch failed", "service", route.service, "subtopic", route.subtopic, "error", err)
	}
}

func (m *MQTTService) routeTopic(topic string) (topicRoute, bool) {
	prefix := m.topicPrefix()
	if topic == prefix+"/command" {
		return topicRoute{service: "", subtopic: "command"}, true
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

func (m *MQTTService) heartbeatPayload() json.RawMessage {
	return marshalPayload(map[string]interface{}{
		"uptime":    time.Since(m.startedAt).Seconds(),
		"device_id": m.cfg.DeviceID,
		"cameras":   m.cfg.Cameras,
		"services":  m.ipcServer.GetStatuses(),
	})
}

func (m *MQTTService) statusPayload() json.RawMessage {
	return marshalPayload(map[string]interface{}{
		"uptime":   time.Since(m.startedAt).Seconds(),
		"deviceId": m.cfg.DeviceID,
		"cameras":  m.cfg.Cameras,
		"services": m.ipcServer.GetStatuses(),
	})
}

func (m *MQTTService) StatusEnvelope() ipc.MQTTEnvelope {
	return buildEnvelope("status", m.statusPayload())
}

func (m *MQTTService) PublishEnvelope(service string, subtopic string, env ipc.MQTTEnvelope) error {
	if strings.TrimSpace(subtopic) == "" {
		return fmt.Errorf("subtopic is required")
	}

	envData, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	topic := m.publishTopic(ipc.PublishMessageRequest{
		Service:  service,
		Subtopic: subtopic,
	})

	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		client, generation, err := m.waitForClient(mqttWaitForReadyTimeout)
		if err != nil {
			lastErr = err
			continue
		}

		token := client.Publish(topic, 1, false, envData)
		if !token.WaitTimeout(mqttConnectTimeout) {
			m.markDisconnected(generation, fmt.Errorf("publish %s timed out", topic))
			lastErr = errMQTTUnavailable
			continue
		}
		if err := token.Error(); err != nil {
			m.markDisconnected(generation, err)
			lastErr = errMQTTUnavailable
			continue
		}
		return nil
	}

	return fmt.Errorf("publish %s: %w", topic, lastErr)
}

func (m *MQTTService) publishTopic(req ipc.PublishMessageRequest) string {
	subtopic := strings.TrimPrefix(req.Subtopic, "/")
	if req.Service == "" {
		return m.topicPrefix() + "/" + subtopic
	}

	return fmt.Sprintf("%s/service/%s/%s", m.topicPrefix(), req.Service, subtopic)
}

func (m *MQTTService) StartHealthMonitor(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !m.hasConnectedClient() {
				m.ensureReconnectLoop()
			}
		}
	}
}

func (m *MQTTService) ensureReconnectLoop() {
	m.reconnectMu.Lock()
	if m.reconnecting || m.isClosed() {
		m.reconnectMu.Unlock()
		return
	}
	m.reconnecting = true
	m.reconnectMu.Unlock()

	go m.reconnectLoop()
}

func (m *MQTTService) reconnectLoop() {
	defer func() {
		m.reconnectMu.Lock()
		m.reconnecting = false
		m.reconnectMu.Unlock()
	}()

	delay := mqttReconnectInitialDelay

	for {
		if m.isClosed() {
			return
		}
		if m.hasConnectedClient() {
			return
		}

		generation := uint64(time.Now().UnixNano())
		client := mqtt.NewClient(m.clientOptions(generation))
		token := client.Connect()

		var err error
		subscribeErr := error(nil)
		switch {
		case !token.WaitTimeout(mqttConnectTimeout):
			err = fmt.Errorf("mqtt connect timed out")
		case token.Error() != nil:
			err = token.Error()
		default:
			subscribeErr = m.subscribe(client)
			err = subscribeErr
		}

		if err == nil {
			m.activateClient(client, generation)
			m.log.Info("connected to broker", "broker", m.cfg.MQTT.BrokerURL)
			return
		}

		client.Disconnect(250)
		if !m.isClosed() {
			m.log.Warn("MQTT connect failed, retrying",
				"broker", m.cfg.MQTT.BrokerURL,
				"error", err,
				"retry_in", delay.String(),
			)
		}

		select {
		case <-m.closedCh:
			return
		case <-time.After(delay):
		}

		delay *= 2
		if delay > mqttReconnectMaxDelay {
			delay = mqttReconnectMaxDelay
		}
	}
}

func (m *MQTTService) clientOptions(generation uint64) *mqtt.ClientOptions {
	return mqtt.NewClientOptions().
		AddBroker(m.cfg.MQTT.BrokerURL).
		SetClientID(m.cfg.MQTT.ClientID).
		SetKeepAlive(time.Duration(m.cfg.MQTT.KeepAliveSec) * time.Second).
		SetCleanSession(true).
		SetAutoReconnect(false).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) {
			m.markDisconnected(generation, err)
		})
}

func (m *MQTTService) activateClient(client mqtt.Client, generation uint64) {
	m.clientMu.Lock()
	oldClient := m.client
	m.client = client
	m.clientGeneration = generation
	close(m.readyCh)
	m.clientMu.Unlock()

	if oldClient != nil && oldClient != client {
		oldClient.Disconnect(250)
	}
}

func (m *MQTTService) markDisconnected(generation uint64, cause error) {
	m.clientMu.Lock()
	if m.client == nil || m.clientGeneration != generation {
		m.clientMu.Unlock()
		return
	}

	client := m.client
	m.client = nil
	m.readyCh = make(chan struct{})
	m.clientMu.Unlock()

	if client != nil && client.IsConnected() {
		client.Disconnect(250)
	}

	if cause != nil && !m.isClosed() {
		m.log.Warn("connection lost", "error", cause)
	}
	m.ensureReconnectLoop()
}

func (m *MQTTService) waitForClient(timeout time.Duration) (mqtt.Client, uint64, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		if m.isClosed() {
			return nil, 0, errMQTTUnavailable
		}

		m.clientMu.RLock()
		client := m.client
		generation := m.clientGeneration
		readyCh := m.readyCh
		m.clientMu.RUnlock()

		if client != nil && client.IsConnected() {
			return client, generation, nil
		}

		m.ensureReconnectLoop()

		select {
		case <-m.closedCh:
			return nil, 0, errMQTTUnavailable
		case <-timer.C:
			return nil, 0, errMQTTUnavailable
		case <-readyCh:
		}
	}
}

func (m *MQTTService) hasConnectedClient() bool {
	m.clientMu.RLock()
	defer m.clientMu.RUnlock()
	return m.client != nil && m.client.IsConnected()
}

func (m *MQTTService) isClosed() bool {
	select {
	case <-m.closedCh:
		return true
	default:
		return false
	}
}

func (m *MQTTService) Disconnect() {
	m.closeOnce.Do(func() {
		close(m.closedCh)

		m.clientMu.Lock()
		client := m.client
		m.client = nil
		m.readyCh = make(chan struct{})
		m.clientMu.Unlock()

		if client != nil {
			client.Disconnect(1000)
		}
	})
}
