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

type CameraConfig struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

type Config struct {
	LogLevel string         `json:"log_level"`
	DeviceID string         `json:"device_id"`
	MQTT     MQTTConfig     `json:"mqtt"`
	IPC      IPCConfig      `json:"ipc"`
	Cameras  []CameraConfig `json:"cameras"`
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

	return cfg, nil
}
