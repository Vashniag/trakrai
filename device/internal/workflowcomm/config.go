package workflowcomm

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "workflow-comm"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type HTTPConfig struct {
	BaseURL           string `json:"base_url"`
	DeviceAccessToken string `json:"device_access_token"`
	RequestTimeoutSec int    `json:"request_timeout_sec"`
	UploadTimeoutSec  int    `json:"upload_timeout_sec"`
	MaxRequestRetries int    `json:"max_request_retries"`
	InitialBackoffMs  int    `json:"initial_backoff_ms"`
	MaxBackoffSec     int    `json:"max_backoff_sec"`
	UserAgent         string `json:"user_agent"`
}

type QueueConfig struct {
	PendingList    string `json:"pending_list"`
	ProcessingList string `json:"processing_list"`
	RetryZSet      string `json:"retry_zset"`
	DeadLetterList string `json:"dead_letter_list"`
	PollTimeoutSec int    `json:"poll_timeout_sec"`
	RetrySweepSec  int    `json:"retry_sweep_sec"`
	MaxAttempts    int    `json:"max_attempts"`
}

type StorageConfig struct {
	FilesRoot           string `json:"files_root"`
	DeleteUploadedFiles bool   `json:"delete_uploaded_files"`
}

type Config struct {
	LogLevel string             `json:"log_level"`
	Redis    redisconfig.Config `json:"redis"`
	IPC      IPCConfig          `json:"ipc"`
	HTTP     HTTPConfig         `json:"http"`
	Queue    QueueConfig        `json:"queue"`
	Storage  StorageConfig      `json:"storage"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		Redis: redisconfig.Config{
			Host:      "localhost",
			Port:      6379,
			DB:        0,
			KeyPrefix: "workflow",
		},
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		HTTP: HTTPConfig{
			RequestTimeoutSec: 15,
			UploadTimeoutSec:  120,
			MaxRequestRetries: 3,
			InitialBackoffMs:  500,
			MaxBackoffSec:     30,
			UserAgent:         "trakrai-workflow-comm/1.0",
		},
		Queue: QueueConfig{
			PollTimeoutSec: 5,
			RetrySweepSec:  2,
			MaxAttempts:    8,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "workflow")
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.HTTP.RequestTimeoutSec <= 0 {
		cfg.HTTP.RequestTimeoutSec = 15
	}
	if cfg.HTTP.UploadTimeoutSec <= 0 {
		cfg.HTTP.UploadTimeoutSec = 120
	}
	if cfg.HTTP.MaxRequestRetries <= 0 {
		cfg.HTTP.MaxRequestRetries = 3
	}
	if cfg.HTTP.InitialBackoffMs <= 0 {
		cfg.HTTP.InitialBackoffMs = 500
	}
	if cfg.HTTP.MaxBackoffSec <= 0 {
		cfg.HTTP.MaxBackoffSec = 30
	}
	if cfg.HTTP.UserAgent == "" {
		cfg.HTTP.UserAgent = "trakrai-workflow-comm/1.0"
	}
	if cfg.Queue.PollTimeoutSec <= 0 {
		cfg.Queue.PollTimeoutSec = 5
	}
	if cfg.Queue.RetrySweepSec <= 0 {
		cfg.Queue.RetrySweepSec = 2
	}
	if cfg.Queue.MaxAttempts <= 0 {
		cfg.Queue.MaxAttempts = 8
	}

	keyPrefix := strings.TrimSpace(cfg.Redis.KeyPrefix)
	if keyPrefix == "" {
		keyPrefix = "workflow"
	}
	if cfg.Queue.PendingList == "" {
		cfg.Queue.PendingList = fmt.Sprintf("%s:cloud:pending", keyPrefix)
	}
	if cfg.Queue.ProcessingList == "" {
		cfg.Queue.ProcessingList = fmt.Sprintf("%s:cloud:processing", keyPrefix)
	}
	if cfg.Queue.RetryZSet == "" {
		cfg.Queue.RetryZSet = fmt.Sprintf("%s:cloud:retry", keyPrefix)
	}
	if cfg.Queue.DeadLetterList == "" {
		cfg.Queue.DeadLetterList = fmt.Sprintf("%s:cloud:dead-letter", keyPrefix)
	}

	if cfg.Storage.FilesRoot != "" {
		cfg.Storage.FilesRoot = filepath.Clean(cfg.Storage.FilesRoot)
	}

	if cfg.Queue.PendingList == cfg.Queue.ProcessingList {
		return nil, fmt.Errorf("queue.pending_list and queue.processing_list must be different")
	}
	if cfg.Queue.RetryZSet == cfg.Queue.PendingList || cfg.Queue.RetryZSet == cfg.Queue.ProcessingList {
		return nil, fmt.Errorf("queue.retry_zset must be distinct from the queue lists")
	}

	return cfg, nil
}
