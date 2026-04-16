package audioalert

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

const ServiceName = "audio-alert"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type PlaybackConfig struct {
	Enabled       bool   `json:"enabled"`
	SpeakerDevice string `json:"speaker_device"`
	DefaultVolume int    `json:"default_volume"`
}

type QueueConfig struct {
	MaxPendingAlerts    int `json:"max_pending_alerts"`
	SimulatedPlaybackMs int `json:"simulated_playback_ms"`
	TickIntervalMs      int `json:"tick_interval_ms"`
}

type WebRTCConfig struct {
	Enabled            bool   `json:"enabled"`
	MaxPeerConnections int    `json:"max_peer_connections"`
	SignallingMode     string `json:"signalling_mode"`
}

type TalkbackConfig struct {
	Enabled     bool         `json:"enabled"`
	MaxSessions int          `json:"max_sessions"`
	Transport   string       `json:"transport"`
	WebRTC      WebRTCConfig `json:"webrtc"`
}

type Config struct {
	IPC      IPCConfig      `json:"ipc"`
	LogLevel string         `json:"log_level"`
	Playback PlaybackConfig `json:"playback"`
	Queue    QueueConfig    `json:"queue"`
	Talkback TalkbackConfig `json:"talkback"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Playback: PlaybackConfig{
			Enabled:       true,
			DefaultVolume: 70,
		},
		Queue: QueueConfig{
			MaxPendingAlerts:    8,
			SimulatedPlaybackMs: 1500,
			TickIntervalMs:      250,
		},
		Talkback: TalkbackConfig{
			Enabled:     true,
			MaxSessions: 2,
			Transport:   "webrtc",
			WebRTC: WebRTCConfig{
				Enabled:            true,
				MaxPeerConnections: 4,
				SignallingMode:     "ipc-bridge",
			},
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Playback.DefaultVolume < 0 || cfg.Playback.DefaultVolume > 100 {
		return nil, fmt.Errorf("playback.default_volume must be between 0 and 100")
	}
	if cfg.Queue.MaxPendingAlerts < 0 {
		return nil, fmt.Errorf("queue.max_pending_alerts must be 0 or greater")
	}
	if cfg.Queue.SimulatedPlaybackMs <= 0 {
		return nil, fmt.Errorf("queue.simulated_playback_ms must be greater than 0")
	}
	if cfg.Queue.TickIntervalMs <= 0 {
		return nil, fmt.Errorf("queue.tick_interval_ms must be greater than 0")
	}
	if cfg.Talkback.MaxSessions < 1 {
		return nil, fmt.Errorf("talkback.max_sessions must be at least 1")
	}
	if cfg.Talkback.Transport == "" {
		cfg.Talkback.Transport = "webrtc"
	}
	if cfg.Talkback.WebRTC.MaxPeerConnections < 1 {
		return nil, fmt.Errorf("talkback.webrtc.max_peer_connections must be at least 1")
	}
	if cfg.Talkback.WebRTC.SignallingMode == "" {
		cfg.Talkback.WebRTC.SignallingMode = "ipc-bridge"
	}

	return cfg, nil
}
