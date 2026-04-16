package audioalert

import (
	"testing"
	"time"
)

func TestNormalizeCommandSetsDefaults(t *testing.T) {
	cfg := &Config{
		Playback: PlaybackConfig{
			Enabled:       true,
			DefaultVolume: 70,
		},
		Talkback: TalkbackConfig{
			Enabled:     true,
			MaxSessions: 2,
		},
	}

	command, err := normalizeCommand(CommandPlayAlert, Command{
		Message: "Wear helmet",
	}, cfg)
	if err != nil {
		t.Fatalf("normalizeCommand returned error: %v", err)
	}

	if command.RequestID == "" {
		t.Fatalf("expected request id to be generated")
	}
	if command.Volume != 70 {
		t.Fatalf("expected default volume to be applied")
	}
	if command.Priority != "normal" {
		t.Fatalf("expected default priority to be applied")
	}
}

func TestNormalizeCommandRequiresTalkbackSession(t *testing.T) {
	cfg := &Config{
		Playback: PlaybackConfig{
			Enabled:       true,
			DefaultVolume: 70,
		},
		Talkback: TalkbackConfig{
			Enabled:     true,
			MaxSessions: 2,
		},
	}

	_, err := normalizeCommand(CommandStartTalkback, Command{}, cfg)
	if err == nil {
		t.Fatalf("expected missing session id to fail")
	}
}

func TestPlayAlertQueuesWhenBusy(t *testing.T) {
	cfg := &Config{
		Playback: PlaybackConfig{
			Enabled:       true,
			DefaultVolume: 60,
		},
		Queue: QueueConfig{
			MaxPendingAlerts:    2,
			SimulatedPlaybackMs: 1000,
			TickIntervalMs:      50,
		},
		Talkback: TalkbackConfig{
			Enabled:     true,
			MaxSessions: 2,
			Transport:   "webrtc",
			WebRTC: WebRTCConfig{
				Enabled:            true,
				MaxPeerConnections: 2,
				SignallingMode:     "ipc-bridge",
			},
		},
	}
	service := &Service{cfg: cfg, state: newState(cfg)}
	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)

	first, err := service.applyCommand(CommandPlayAlert, Command{
		RequestID: "alert-1",
		Message:   "Wear helmet",
		Volume:    65,
		Priority:  "high",
	}, now)
	if err != nil {
		t.Fatalf("first play-alert failed: %v", err)
	}
	if first.Status != "accepted" {
		t.Fatalf("expected first alert to be accepted, got %q", first.Status)
	}

	second, err := service.applyCommand(CommandPlayAlert, Command{
		RequestID: "alert-2",
		Message:   "Keep distance",
		Volume:    55,
		Priority:  "normal",
	}, now.Add(100*time.Millisecond))
	if err != nil {
		t.Fatalf("second play-alert failed: %v", err)
	}
	if second.Status != "queued" {
		t.Fatalf("expected second alert to be queued, got %q", second.Status)
	}
	if len(service.state.PendingAlerts) != 1 {
		t.Fatalf("expected one queued alert, got %d", len(service.state.PendingAlerts))
	}

	advanced := service.advanceQueue(now.Add(2 * time.Second))
	if !advanced {
		t.Fatalf("expected queue to advance")
	}
	if service.state.ActiveAlert == nil || service.state.ActiveAlert.RequestID != "alert-2" {
		t.Fatalf("expected queued alert to become active")
	}
	if service.state.CompletedAlerts != 1 {
		t.Fatalf("expected one completed alert, got %d", service.state.CompletedAlerts)
	}
}

func TestStartTalkbackRespectsCapacity(t *testing.T) {
	cfg := &Config{
		Playback: PlaybackConfig{
			Enabled:       true,
			DefaultVolume: 60,
		},
		Queue: QueueConfig{
			MaxPendingAlerts:    2,
			SimulatedPlaybackMs: 1000,
			TickIntervalMs:      50,
		},
		Talkback: TalkbackConfig{
			Enabled:     true,
			MaxSessions: 1,
			Transport:   "webrtc",
			WebRTC: WebRTCConfig{
				Enabled:            true,
				MaxPeerConnections: 1,
				SignallingMode:     "ipc-bridge",
			},
		},
	}
	service := &Service{cfg: cfg, state: newState(cfg)}
	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)

	if _, err := service.applyCommand(CommandStartTalkback, Command{
		RequestID: "talk-1",
		SessionID: "session-1",
		Metadata: map[string]interface{}{
			"offer_id": "offer-1",
		},
	}, now); err != nil {
		t.Fatalf("start talkback failed: %v", err)
	}

	if _, err := service.applyCommand(CommandStartTalkback, Command{
		RequestID: "talk-2",
		SessionID: "session-2",
	}, now.Add(time.Second)); err == nil {
		t.Fatalf("expected talkback capacity error")
	}

	if got := service.state.ActiveTalkbacks["session-1"].Transport; got != "webrtc-stub" {
		t.Fatalf("expected webrtc-stub transport, got %q", got)
	}
}
