package cloudcomm

import (
	"errors"
	"testing"

	"github.com/trakrai/device-services/internal/ipc"
)

type stubEnvelopePublisher struct {
	err error
}

func (s stubEnvelopePublisher) PublishEnvelope(_ string, _ string, _ ipc.MQTTEnvelope) error {
	return s.err
}

type stubOutboundBroadcaster struct {
	deliveries int
}

func (s stubOutboundBroadcaster) Broadcast(_ string, _ string, _ ipc.MQTTEnvelope) int {
	return s.deliveries
}

func TestTransportPublisherSucceedsWhenEdgeDeliveryExists(t *testing.T) {
	t.Parallel()

	publisher := NewTransportPublisher(
		stubEnvelopePublisher{err: errors.New("mqtt unavailable")},
		stubOutboundBroadcaster{deliveries: 1},
	)

	err := publisher.Publish(ipc.PublishMessageRequest{
		Service:  ptzServiceName,
		Subtopic: "response",
		Type:     "ptz-command-ack",
		Payload:  marshalPayload(map[string]interface{}{"ok": true}),
	})
	if err != nil {
		t.Fatalf("expected edge delivery to satisfy publish, got error: %v", err)
	}
}

func TestTransportPublisherFailsWhenNoTransportDelivers(t *testing.T) {
	t.Parallel()

	publisher := NewTransportPublisher(
		stubEnvelopePublisher{err: errors.New("mqtt unavailable")},
		stubOutboundBroadcaster{deliveries: 0},
	)

	err := publisher.Publish(ipc.PublishMessageRequest{
		Service:  liveFeedServiceName,
		Subtopic: "response",
		Type:     "start-live-ack",
		Payload:  marshalPayload(map[string]interface{}{"ok": true}),
	})
	if err == nil {
		t.Fatal("expected publish to fail when MQTT is down and edge has no clients")
	}
}
