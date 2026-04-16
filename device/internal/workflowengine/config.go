package workflowengine

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "workflow-engine"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type QueueConfig struct {
	BlockTimeoutSec int    `json:"block_timeout_sec"`
	FrameQueueKey   string `json:"frame_queue_key"`
	StaleAfterSec   int    `json:"stale_after_sec"`
}

type StatusConfig struct {
	ReportIntervalSec int `json:"report_interval_sec"`
}

type WorkflowConfig struct {
	DefinitionPath    string `json:"definition_path"`
	ReloadIntervalSec int    `json:"reload_interval_sec"`
}

type Config struct {
	IPC      IPCConfig          `json:"ipc"`
	LogLevel string             `json:"log_level"`
	Queue    QueueConfig        `json:"queue"`
	Redis    redisconfig.Config `json:"redis"`
	Status   StatusConfig       `json:"status"`
	Workflow WorkflowConfig     `json:"workflow"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Queue: QueueConfig{
			BlockTimeoutSec: 5,
			FrameQueueKey:   "workflow:frames",
			StaleAfterSec:   30,
		},
		Redis: redisconfig.Config{
			Host:      "localhost",
			Port:      6379,
			DB:        0,
			KeyPrefix: "camera",
		},
		Status: StatusConfig{
			ReportIntervalSec: 10,
		},
		Workflow: WorkflowConfig{
			ReloadIntervalSec: 5,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Queue.FrameQueueKey == "" {
		return nil, fmt.Errorf("queue.frame_queue_key is required")
	}
	if cfg.Queue.BlockTimeoutSec <= 0 {
		return nil, fmt.Errorf("queue.block_timeout_sec must be greater than 0")
	}
	if cfg.Queue.StaleAfterSec < 0 {
		return nil, fmt.Errorf("queue.stale_after_sec must be 0 or greater")
	}
	if cfg.Status.ReportIntervalSec <= 0 {
		return nil, fmt.Errorf("status.report_interval_sec must be greater than 0")
	}
	if cfg.Workflow.ReloadIntervalSec <= 0 {
		cfg.Workflow.ReloadIntervalSec = 5
	}

	return cfg, nil
}
