package livefeed

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "live-feed"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type TURNServer struct {
	URL        string `json:"url"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

type WebRTCConfig struct {
	AdvertiseRelayCandidates bool         `json:"advertise_relay_candidates"`
	STUNServers              []string     `json:"stun_servers"`
	TURNServers              []TURNServer `json:"turn_servers"`
	FramerateFPS             int          `json:"framerate_fps"`
}

type Config struct {
	LogLevel string             `json:"log_level"`
	Redis    redisconfig.Config `json:"redis"`
	IPC      IPCConfig          `json:"ipc"`
	WebRTC   WebRTCConfig       `json:"webrtc"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		Redis: redisconfig.Config{
			Host:      "localhost",
			Port:      6379,
			DB:        0,
			KeyPrefix: "camera",
		},
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		WebRTC: WebRTCConfig{
			FramerateFPS: 10,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}

	return cfg, nil
}
