package cloudtransfer

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

const ServiceName = "cloud-transfer"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type StorageConfig struct {
	DatabasePath string `json:"database_path"`
	SharedDir    string `json:"shared_dir"`
}

type CloudAPIConfig struct {
	AuthToken                  string `json:"auth_token"`
	BaseURL                    string `json:"base_url"`
	DownloadPresignPath        string `json:"download_presign_path"`
	PackageDownloadPresignPath string `json:"package_download_presign_path"`
	RequestTimeoutSec          int    `json:"request_timeout_sec"`
	UploadPresignPath          string `json:"upload_presign_path"`
}

type QueueConfig struct {
	InitialBackoffSec       int `json:"initial_backoff_sec"`
	MaxBackoffSec           int `json:"max_backoff_sec"`
	PollIntervalMs          int `json:"poll_interval_ms"`
	StatusReportIntervalSec int `json:"status_report_interval_sec"`
	WorkerCount             int `json:"worker_count"`
}

type Config struct {
	CloudAPI CloudAPIConfig `json:"cloud_api"`
	DeviceID string         `json:"device_id"`
	IPC      IPCConfig      `json:"ipc"`
	LogLevel string         `json:"log_level"`
	Queue    QueueConfig    `json:"queue"`
	Storage  StorageConfig  `json:"storage"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		CloudAPI: CloudAPIConfig{
			DownloadPresignPath:        "/api/v1/device-storage/presign-download",
			PackageDownloadPresignPath: "/api/v1/package-storage/presign-download",
			RequestTimeoutSec:          30,
			UploadPresignPath:          "/api/v1/device-storage/presign-upload",
		},
		DeviceID: "default",
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		LogLevel: "info",
		Queue: QueueConfig{
			InitialBackoffSec:       5,
			MaxBackoffSec:           300,
			PollIntervalMs:          1000,
			StatusReportIntervalSec: 15,
			WorkerCount:             1,
		},
		Storage: StorageConfig{
			DatabasePath: filepath.Join(os.TempDir(), "trakrai-cloud-transfer", "transfers.sqlite"),
			SharedDir:    filepath.Join(os.TempDir(), "trakrai-cloud-transfer", "shared"),
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.LogLevel = normalizeDefault(cfg.LogLevel, "info")
	cfg.DeviceID = normalizeDefault(cfg.DeviceID, "default")
	cfg.IPC.SocketPath = normalizeDefault(cfg.IPC.SocketPath, "/tmp/trakrai-cloud-comm.sock")
	cfg.CloudAPI.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.CloudAPI.BaseURL), "/")
	cfg.CloudAPI.AuthToken = strings.TrimSpace(cfg.CloudAPI.AuthToken)
	cfg.CloudAPI.UploadPresignPath = normalizeDefault(
		cfg.CloudAPI.UploadPresignPath,
		"/api/v1/device-storage/presign-upload",
	)
	cfg.CloudAPI.DownloadPresignPath = normalizeDefault(
		cfg.CloudAPI.DownloadPresignPath,
		"/api/v1/device-storage/presign-download",
	)
	cfg.CloudAPI.PackageDownloadPresignPath = normalizeDefault(
		cfg.CloudAPI.PackageDownloadPresignPath,
		"/api/v1/package-storage/presign-download",
	)
	if cfg.CloudAPI.RequestTimeoutSec <= 0 {
		cfg.CloudAPI.RequestTimeoutSec = 30
	}
	if cfg.Queue.InitialBackoffSec <= 0 {
		cfg.Queue.InitialBackoffSec = 5
	}
	if cfg.Queue.MaxBackoffSec < cfg.Queue.InitialBackoffSec {
		cfg.Queue.MaxBackoffSec = cfg.Queue.InitialBackoffSec
	}
	if cfg.Queue.PollIntervalMs <= 0 {
		cfg.Queue.PollIntervalMs = 1000
	}
	if cfg.Queue.StatusReportIntervalSec <= 0 {
		cfg.Queue.StatusReportIntervalSec = 15
	}
	if cfg.Queue.WorkerCount <= 0 {
		cfg.Queue.WorkerCount = 1
	}
	if cfg.Storage.DatabasePath == "" {
		cfg.Storage.DatabasePath = filepath.Join(os.TempDir(), "trakrai-cloud-transfer", "transfers.sqlite")
	}
	if cfg.Storage.SharedDir == "" {
		cfg.Storage.SharedDir = filepath.Join(os.TempDir(), "trakrai-cloud-transfer", "shared")
	}

	cfg.Storage.DatabasePath = filepath.Clean(cfg.Storage.DatabasePath)
	cfg.Storage.SharedDir = filepath.Clean(cfg.Storage.SharedDir)

	if cfg.CloudAPI.BaseURL == "" {
		return nil, fmt.Errorf("cloud_api.base_url is required")
	}
	if cfg.DeviceID == "" {
		return nil, fmt.Errorf("device_id is required")
	}
	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Storage.DatabasePath == "" {
		return nil, fmt.Errorf("storage.database_path is required")
	}
	if cfg.Storage.SharedDir == "" {
		return nil, fmt.Errorf("storage.shared_dir is required")
	}

	return cfg, nil
}

func normalizeDefault(value string, fallback string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return fallback
	}
	return normalized
}
