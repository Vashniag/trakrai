package roiconfig

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

const ServiceName = "roi-config"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type StorageConfig struct {
	FilePath string `json:"file_path"`
}

type rawConfig struct {
	IPC      IPCConfig     `json:"ipc"`
	LogLevel string        `json:"log_level"`
	Storage  StorageConfig `json:"storage"`
}

type Config struct {
	IPC      IPCConfig
	LogLevel string
	Storage  StorageConfig
}

func LoadConfig(path string) (*Config, error) {
	raw := rawConfig{
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		LogLevel: "info",
		Storage: StorageConfig{
			FilePath: "/home/hacklab/trakrai-device-runtime/shared/roi-config.json",
		},
	}

	if err := configjson.Load(path, &raw); err != nil {
		return nil, err
	}
	if raw.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if raw.Storage.FilePath == "" {
		return nil, fmt.Errorf("storage.file_path is required")
	}

	return &Config{
		IPC:      raw.IPC,
		LogLevel: raw.LogLevel,
		Storage:  raw.Storage,
	}, nil
}
