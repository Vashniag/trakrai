package transfermanager

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type HTTPConfig struct {
	BaseURL           string `json:"base_url"`
	RequestTimeoutSec int    `json:"request_timeout_sec"`
	UserAgent         string `json:"user_agent"`
}

type QueueConfig struct {
	DatabasePath    string `json:"database_path"`
	MaxInFlight     int    `json:"max_in_flight"`
	PollIntervalSec int    `json:"poll_interval_sec"`
}

type Config struct {
	HTTP     HTTPConfig  `json:"http"`
	IPC      IPCConfig   `json:"ipc"`
	LogLevel string      `json:"log_level"`
	Queue    QueueConfig `json:"queue"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		HTTP: HTTPConfig{
			RequestTimeoutSec: 30,
			UserAgent:         "trakrai-transfer-manager/1.0",
		},
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Queue: QueueConfig{
			DatabasePath:    "/var/lib/trakrai/transfer-manager/queue.db",
			MaxInFlight:     4,
			PollIntervalSec: 2,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	if strings.TrimSpace(cfg.IPC.SocketPath) == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.HTTP.RequestTimeoutSec <= 0 {
		cfg.HTTP.RequestTimeoutSec = 30
	}
	if strings.TrimSpace(cfg.HTTP.UserAgent) == "" {
		cfg.HTTP.UserAgent = "trakrai-transfer-manager/1.0"
	}
	if cfg.Queue.PollIntervalSec <= 0 {
		cfg.Queue.PollIntervalSec = 2
	}
	if cfg.Queue.MaxInFlight <= 0 {
		cfg.Queue.MaxInFlight = 4
	}
	if strings.TrimSpace(cfg.Queue.DatabasePath) == "" {
		return nil, fmt.Errorf("queue.database_path is required")
	}
	cfg.Queue.DatabasePath = filepath.Clean(cfg.Queue.DatabasePath)

	return cfg, nil
}

