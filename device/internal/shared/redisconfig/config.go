package redisconfig

import "fmt"

type Config struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Password  string `json:"password"`
	DB        int    `json:"db"`
	KeyPrefix string `json:"key_prefix"`
}

func WithDefaults(cfg Config, defaultKeyPrefix string) Config {
	if cfg.Host == "" {
		cfg.Host = "localhost"
	}
	if cfg.Port == 0 {
		cfg.Port = 6379
	}
	if cfg.KeyPrefix == "" {
		cfg.KeyPrefix = defaultKeyPrefix
	}
	return cfg
}

func Address(cfg Config) string {
	return fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
}
