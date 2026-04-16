package cloudcomm

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type envelopePublisher interface {
	PublishEnvelope(service string, subtopic string, env ipc.MQTTEnvelope) error
}

type outboundBroadcaster interface {
	Broadcast(service string, subtopic string, env ipc.MQTTEnvelope) int
}

type TransportPublisher struct {
	log  *slog.Logger
	mqtt envelopePublisher
	edge outboundBroadcaster
}

func NewTransportPublisher(mqtt envelopePublisher, edge outboundBroadcaster) *TransportPublisher {
	return &TransportPublisher{
		log:  slog.With("component", "transport-publisher"),
		mqtt: mqtt,
		edge: edge,
	}
}

func marshalPayload(payload interface{}) json.RawMessage {
	data, _ := json.Marshal(payload)
	return data
}

func buildEnvelope(msgType string, payload json.RawMessage) ipc.MQTTEnvelope {
	if len(payload) == 0 {
		payload = marshalPayload(map[string]interface{}{})
	}

	return ipc.MQTTEnvelope{
		MsgID:     fmt.Sprintf("%d", time.Now().UnixNano()),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Type:      msgType,
		Payload:   payload,
	}
}

func (p *TransportPublisher) Publish(req ipc.PublishMessageRequest) error {
	if req.Subtopic == "" || req.Type == "" {
		return fmt.Errorf("subtopic and type are required")
	}

	mode, err := normalizePublishMode(req.Mode)
	if err != nil {
		return err
	}

	env := buildEnvelope(req.Type, req.Payload)

	websocketDeliveries := 0
	if mode.allowsEdge() && p.edge != nil {
		websocketDeliveries = p.edge.Broadcast(req.Service, req.Subtopic, env)
	}

	var mqttErr error
	mqttDelivered := false
	if mode.allowsMQTT() {
		if p.mqtt == nil {
			mqttErr = fmt.Errorf("mqtt publisher is unavailable")
		} else if err := p.mqtt.PublishEnvelope(req.Service, req.Subtopic, env); err != nil {
			mqttErr = err
		} else {
			mqttDelivered = true
		}
	}

	if mode == publishModeMQTTOnly {
		if mqttErr != nil {
			return mqttErr
		}
		return nil
	}

	if mode == publishModeEdgeOnly {
		return nil
	}

	if false && p.mqtt != nil {
		if err := p.mqtt.PublishEnvelope(req.Service, req.Subtopic, env); err != nil {
			mqttErr = err
		} else {
			mqttDelivered = true
		}
	}

	if mqttDelivered || websocketDeliveries > 0 {
		if mqttErr != nil {
			p.log.Warn("MQTT publish failed while edge delivery succeeded",
				"service", req.Service,
				"subtopic", req.Subtopic,
				"type", req.Type,
				"error", mqttErr,
			)
		}
		return nil
	}

	if mqttErr != nil {
		return mqttErr
	}

	return nil
}

type publishMode string

const (
	publishModeAll      publishMode = "all"
	publishModeEdgeOnly publishMode = "edge"
	publishModeMQTTOnly publishMode = "mqtt"
)

func normalizePublishMode(raw string) (publishMode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "all":
		return publishModeAll, nil
	case "edge":
		return publishModeEdgeOnly, nil
	case "mqtt":
		return publishModeMQTTOnly, nil
	default:
		return "", fmt.Errorf("unsupported publish mode %q", raw)
	}
}

func (m publishMode) allowsEdge() bool {
	return m == publishModeAll || m == publishModeEdgeOnly
}

func (m publishMode) allowsMQTT() bool {
	return m == publishModeAll || m == publishModeMQTTOnly
}
