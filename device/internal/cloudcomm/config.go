package cloudcomm

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
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

type EdgeWebSocketConfig struct {
	Enabled        bool             `json:"enabled"`
	ListenAddr     string           `json:"listen_addr"`
	Path           string           `json:"path"`
	AllowedOrigins []string         `json:"allowed_origins"`
	WebRTC         EdgeWebRTCConfig `json:"webrtc"`
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
	cfg := &Config{
		LogLevel: "info",
		DeviceID: "default",
		MQTT: MQTTConfig{
			BrokerURL:    "tcp://localhost:1883",
			ClientID:     "trakrai-device",
			KeepAliveSec: 30,
		},
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Edge: EdgeWebSocketConfig{
			Enabled:    false,
			ListenAddr: ":8080",
			Path:       "/ws",
			WebRTC: EdgeWebRTCConfig{
				ICEServers: []EdgeICEServerConfig{
					{URLs: []string{"stun:stun.l.google.com:19302"}},
				},
			},
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
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

	return cfg, nil
}
