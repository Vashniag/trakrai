package cloudcomm

import (
	"errors"
	"testing"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type stubEnvelopePublisher struct {
	delay      time.Duration
	err        error
	publishCh  chan struct{}
}

func (s stubEnvelopePublisher) PublishEnvelope(_ string, _ string, _ ipc.MQTTEnvelope) error {
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	if s.publishCh != nil {
		select {
		case s.publishCh <- struct{}{}:
		default:
		}
	}
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

	publishCh := make(chan struct{}, 1)
	publisher := NewTransportPublisher(
		stubEnvelopePublisher{
			delay:     200 * time.Millisecond,
			err:       errors.New("mqtt unavailable"),
			publishCh: publishCh,
		},
		stubOutboundBroadcaster{deliveries: 1},
	)

	startedAt := time.Now()
	err := publisher.Publish(ipc.PublishMessageRequest{
		Service:  "ptz-control",
		Subtopic: "response",
		Type:     "ptz-command-ack",
		Payload:  marshalPayload(map[string]interface{}{"ok": true}),
	})
	if err != nil {
		t.Fatalf("expected edge delivery to satisfy publish, got error: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed >= 100*time.Millisecond {
		t.Fatalf("expected publish to return without waiting on MQTT, took %v", elapsed)
	}

	select {
	case <-publishCh:
	case <-time.After(time.Second):
		t.Fatal("expected MQTT publish to still run in the background")
	}
}

func TestTransportPublisherFailsWhenNoTransportDelivers(t *testing.T) {
	t.Parallel()

	publisher := NewTransportPublisher(
		stubEnvelopePublisher{err: errors.New("mqtt unavailable")},
		stubOutboundBroadcaster{deliveries: 0},
	)

	err := publisher.Publish(ipc.PublishMessageRequest{
		Service:  "live-feed",
		Subtopic: "response",
		Type:     "start-live-ack",
		Payload:  marshalPayload(map[string]interface{}{"ok": true}),
	})
	if err == nil {
		t.Fatal("expected publish to fail when MQTT is down and edge has no clients")
	}
}
