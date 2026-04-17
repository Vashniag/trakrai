package livefeed

import (
	"io"
	"log/slog"
	"testing"
)

type testSessionControl struct {
	details map[string]interface{}
	status  string
}

func (c *testSessionControl) Publish(subtopic string, msgType string, payload interface{}) error {
	_ = subtopic
	_ = msgType
	_ = payload
	return nil
}

func (c *testSessionControl) ReportStatus(status string, details map[string]interface{}) error {
	c.status = status
	c.details = details
	return nil
}

func TestSessionManagerStopSessionByRequestID(t *testing.T) {
	t.Parallel()

	control := &testSessionControl{}
	manager := &SessionManager{
		control: control,
		log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*liveSession{
			"session-1": {
				cameraName: "Camera-1",
				layoutPlan: LiveLayoutPlan{
					CameraNames: []string{"Camera-1"},
					FrameSource: LiveFrameSourceRaw,
					Mode:        LiveLayoutSingle,
				},
				requestID: "req-1",
				sessionID: "session-1",
				state:     "streaming",
			},
		},
	}

	manager.StopSessionByRequestID("req-1")

	if len(manager.sessions) != 0 {
		t.Fatalf("expected request-owned session to be removed, found %d active sessions", len(manager.sessions))
	}
	if control.status != "idle" {
		t.Fatalf("expected idle status after stop, got %q", control.status)
	}
	if got := control.details["requestId"]; got != "req-1" {
		t.Fatalf("expected requestId req-1 in status details, got %#v", got)
	}
	if got := control.details["sessionId"]; got != "session-1" {
		t.Fatalf("expected sessionId session-1 in status details, got %#v", got)
	}
}
