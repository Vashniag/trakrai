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

type CompositeConfig struct {
	Height      int `json:"height"`
	TilePadding int `json:"tile_padding"`
	Width       int `json:"width"`
}

type Config struct {
	LogLevel  string             `json:"log_level"`
	Redis     redisconfig.Config `json:"redis"`
	IPC       IPCConfig          `json:"ipc"`
	WebRTC    WebRTCConfig       `json:"webrtc"`
	Composite CompositeConfig    `json:"composite"`
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
		Composite: CompositeConfig{
			Width:       960,
			Height:      540,
			TilePadding: 8,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Composite.Width <= 0 {
		return nil, fmt.Errorf("composite.width must be greater than 0")
	}
	if cfg.Composite.Height <= 0 {
		return nil, fmt.Errorf("composite.height must be greater than 0")
	}
	if cfg.Composite.TilePadding < 0 {
		return nil, fmt.Errorf("composite.tile_padding must be zero or greater")
	}

	return cfg, nil
}
