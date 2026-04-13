package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type RedisConfig struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Password  string `json:"password"`
	DB        int    `json:"db"`
	KeyPrefix string `json:"key_prefix"`
}

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type TURNServer struct {
	URL        string `json:"url"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

type WebRTCConfig struct {
	STUNServers  []string     `json:"stun_servers"`
	TURNServers  []TURNServer `json:"turn_servers"`
	FramerateFPS int          `json:"framerate_fps"`
}

type Config struct {
	LogLevel string       `json:"log_level"`
	Redis    RedisConfig  `json:"redis"`
	IPC      IPCConfig    `json:"ipc"`
	WebRTC   WebRTCConfig `json:"webrtc"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{
		LogLevel: "info",
		Redis: RedisConfig{
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

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}

	return cfg, nil
}
