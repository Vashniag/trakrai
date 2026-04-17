package roiconfig

import (
	"fmt"

	"github.com/trakrai/device-services/internal/generatedconfig"
)

const ServiceName = "roi-config"

type Config = generatedconfig.RoiConfigConfig

func LoadConfig(path string) (*Config, error) {
	cfg, err := generatedconfig.LoadRoiConfigConfig(path)
	if err != nil {
		return nil, err
	}
	if cfg.Ipc.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Storage.FilePath == "" {
		return nil, fmt.Errorf("storage.file_path is required")
	}
	return &cfg, nil
}
