package cloudcomm

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/generatedconfig"
)

type MQTTConfig struct {
	BrokerURL    string `json:"broker_url"`
	ClientID     string `json:"client_id"`
	KeepAliveSec int    `json:"keep_alive_sec"`
}

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type EdgeICEServerConfig struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
}

type EdgeWebRTCConfig struct {
	ICEServers []EdgeICEServerConfig `json:"ice_servers"`
}

type EdgeUIConfig struct {
	Enabled            bool   `json:"enabled"`
	StaticDir          string `json:"static_dir"`
	DiagnosticsEnabled bool   `json:"diagnostics_enabled"`
	TransportMode      string `json:"transport_mode"`
	CloudBridgeURL     string `json:"cloud_bridge_url"`
	ManagementService  string `json:"management_service"`
}

type EdgeRateLimitConfig struct {
	MaxCommandMessages int `json:"max_command_messages"`
	MaxMessages        int `json:"max_messages"`
	WindowSec          int `json:"window_sec"`
}

type EdgeWebSocketConfig struct {
	Enabled    bool                `json:"enabled"`
	ListenAddr string              `json:"listen_addr"`
	Path       string              `json:"path"`
	RateLimit  EdgeRateLimitConfig `json:"rate_limit"`
	WebRTC     EdgeWebRTCConfig    `json:"webrtc"`
	UI         EdgeUIConfig        `json:"ui"`
}

type CameraConfig struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

type Config struct {
	LogLevel string              `json:"log_level"`
	DeviceID string              `json:"device_id"`
	MQTT     MQTTConfig          `json:"mqtt"`
	IPC      IPCConfig           `json:"ipc"`
	Edge     EdgeWebSocketConfig `json:"edge"`
	Cameras  []CameraConfig      `json:"cameras"`
}

func LoadConfig(path string) (*Config, error) {
	raw, err := generatedconfig.LoadCloudCommConfig(path)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		LogLevel: raw.LogLevel,
		DeviceID: raw.DeviceId,
		MQTT: MQTTConfig{
			BrokerURL:    raw.Mqtt.BrokerUrl,
			ClientID:     raw.Mqtt.ClientId,
			KeepAliveSec: raw.Mqtt.KeepAliveSec,
		},
		IPC: IPCConfig{
			SocketPath: raw.Ipc.SocketPath,
		},
		Edge: EdgeWebSocketConfig{
			Enabled:    raw.Edge.Enabled,
			ListenAddr: raw.Edge.ListenAddr,
			Path:       raw.Edge.Path,
			RateLimit: EdgeRateLimitConfig{
				MaxCommandMessages: raw.Edge.RateLimit.MaxCommandMessages,
				MaxMessages:        raw.Edge.RateLimit.MaxMessages,
				WindowSec:          raw.Edge.RateLimit.WindowSec,
			},
			WebRTC: EdgeWebRTCConfig{},
			UI: EdgeUIConfig{
				Enabled:            raw.Edge.Ui.Enabled,
				StaticDir:          raw.Edge.Ui.StaticDir,
				DiagnosticsEnabled: raw.Edge.Ui.DiagnosticsEnabled,
				TransportMode:      raw.Edge.Ui.TransportMode,
				CloudBridgeURL:     raw.Edge.Ui.CloudBridgeUrl,
				ManagementService:  raw.Edge.Ui.ManagementService,
			},
		},
	}
	for _, server := range raw.Edge.Webrtc.IceServers {
		cfg.Edge.WebRTC.ICEServers = append(
			cfg.Edge.WebRTC.ICEServers,
			EdgeICEServerConfig{
				URLs:       append([]string(nil), server.Urls...),
				Username:   server.Username,
				Credential: server.Credential,
			},
		)
	}
	for _, camera := range raw.Cameras {
		cfg.Cameras = append(
			cfg.Cameras,
			CameraConfig{
				Name:    camera.Name,
				Enabled: camera.Enabled,
			},
		)
	}

	if cfg.MQTT.BrokerURL == "" {
		return nil, fmt.Errorf("mqtt.broker_url is required")
	}
	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Edge.Enabled {
		if cfg.Edge.ListenAddr == "" {
			return nil, fmt.Errorf("edge.listen_addr is required when edge is enabled")
		}
		if cfg.Edge.Path == "" {
			return nil, fmt.Errorf("edge.path is required when edge is enabled")
		}
	}
	if cfg.Edge.RateLimit.MaxMessages <= 0 {
		return nil, fmt.Errorf("edge.rate_limit.max_messages must be greater than 0")
	}
	if cfg.Edge.RateLimit.MaxCommandMessages <= 0 {
		return nil, fmt.Errorf("edge.rate_limit.max_command_messages must be greater than 0")
	}
	if cfg.Edge.RateLimit.MaxCommandMessages > cfg.Edge.RateLimit.MaxMessages {
		return nil, fmt.Errorf("edge.rate_limit.max_command_messages must be less than or equal to edge.rate_limit.max_messages")
	}
	if cfg.Edge.RateLimit.WindowSec <= 0 {
		return nil, fmt.Errorf("edge.rate_limit.window_sec must be greater than 0")
	}
	if cfg.Edge.UI.StaticDir != "" {
		cfg.Edge.UI.Enabled = true
		cfg.Edge.UI.StaticDir = filepath.Clean(cfg.Edge.UI.StaticDir)
	}
	if cfg.Edge.UI.TransportMode == "" {
		cfg.Edge.UI.TransportMode = "edge"
	}
	if !strings.EqualFold(cfg.Edge.UI.TransportMode, "cloud") &&
		!strings.EqualFold(cfg.Edge.UI.TransportMode, "edge") {
		return nil, fmt.Errorf("edge.ui.transport_mode must be either cloud or edge")
	}
	cfg.Edge.UI.TransportMode = strings.ToLower(cfg.Edge.UI.TransportMode)
	cfg.Edge.UI.ManagementService = strings.TrimSpace(cfg.Edge.UI.ManagementService)
	if cfg.Edge.UI.ManagementService == "" {
		cfg.Edge.UI.ManagementService = "runtime-manager"
	}
	cfg.Edge.UI.CloudBridgeURL = strings.TrimSpace(cfg.Edge.UI.CloudBridgeURL)
	if cfg.Edge.UI.Enabled && cfg.Edge.UI.StaticDir == "" {
		return nil, fmt.Errorf("edge.ui.static_dir is required when edge.ui is enabled")
	}

	return cfg, nil
}
