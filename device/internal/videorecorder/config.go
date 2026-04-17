package videorecorder

import (
	"fmt"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "video-recorder"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type StorageConfig struct {
	SharedDir string `json:"shared_dir"`
}

type BufferConfig struct {
	DurationSec             int `json:"duration_sec"`
	MaxBytesPerCamera       int `json:"max_bytes_per_camera"`
	MaxFramesPerCamera      int `json:"max_frames_per_camera"`
	PollIntervalMs          int `json:"poll_interval_ms"`
	StatusReportIntervalSec int `json:"status_report_interval_sec"`
}

type QueueConfig struct {
	MaxPending  int `json:"max_pending"`
	WorkerCount int `json:"worker_count"`
}

type RecordingConfig struct {
	DefaultFrameRate int    `json:"default_frame_rate"`
	DefaultPostSec   int    `json:"default_post_sec"`
	DefaultPreSec    int    `json:"default_pre_sec"`
	GStreamerBin     string `json:"gstreamer_bin"`
	MaxFrameRate     int    `json:"max_frame_rate"`
	WriteTimeoutSec  int    `json:"write_timeout_sec"`
}

type UploadConfig struct {
	ServiceName string `json:"service_name"`
}

type CameraConfig struct {
	Enabled bool   `json:"enabled"`
	ID      string `json:"id"`
	Height  int    `json:"height"`
	Name    string `json:"name"`
	Width   int    `json:"width"`
}

type rawCamera struct {
	Enabled *bool       `json:"enabled"`
	Height  int         `json:"height"`
	ID      interface{} `json:"id"`
	Name    string      `json:"name"`
	Width   int         `json:"width"`
}

type rawConfig struct {
	Buffer    BufferConfig       `json:"buffer"`
	DeviceID  string             `json:"device_id"`
	IPC       IPCConfig          `json:"ipc"`
	LogLevel  string             `json:"log_level"`
	Queue     QueueConfig        `json:"queue"`
	Recording RecordingConfig    `json:"recording"`
	Redis     redisconfig.Config `json:"redis"`
	Storage   StorageConfig      `json:"storage"`
	Upload    UploadConfig       `json:"upload"`
	Cameras   []rawCamera        `json:"cameras"`
}

type Config struct {
	Buffer    BufferConfig
	DeviceID  string
	IPC       IPCConfig
	LogLevel  string
	Queue     QueueConfig
	Recording RecordingConfig
	Redis     redisconfig.Config
	Storage   StorageConfig
	Upload    UploadConfig
	Cameras   []CameraConfig
}

func LoadConfig(path string) (*Config, error) {
	raw := rawConfig{
		Buffer: BufferConfig{
			DurationSec:             600,
			MaxBytesPerCamera:       256 * 1024 * 1024,
			MaxFramesPerCamera:      6000,
			PollIntervalMs:          100,
			StatusReportIntervalSec: 5,
		},
		DeviceID: "trakrai-device",
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		LogLevel: "info",
		Queue: QueueConfig{
			MaxPending:  64,
			WorkerCount: 1,
		},
		Recording: RecordingConfig{
			DefaultFrameRate: 10,
			DefaultPostSec:   5,
			DefaultPreSec:    5,
			GStreamerBin:     "gst-launch-1.0",
			MaxFrameRate:     25,
			WriteTimeoutSec:  60,
		},
		Redis: redisconfig.Config{
			KeyPrefix: "camera",
		},
		Storage: StorageConfig{
			SharedDir: "/home/hacklab/trakrai-device-runtime/shared",
		},
		Upload: UploadConfig{
			ServiceName: "cloud-transfer",
		},
	}

	if err := configjson.Load(path, &raw); err != nil {
		return nil, err
	}

	cfg := &Config{
		Buffer:    raw.Buffer,
		DeviceID:  strings.TrimSpace(raw.DeviceID),
		IPC:       raw.IPC,
		LogLevel:  strings.TrimSpace(raw.LogLevel),
		Queue:     raw.Queue,
		Recording: raw.Recording,
		Redis:     redisconfig.WithDefaults(raw.Redis, "camera"),
		Storage:   raw.Storage,
		Upload:    raw.Upload,
	}

	if cfg.DeviceID == "" {
		cfg.DeviceID = "trakrai-device"
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if strings.TrimSpace(cfg.Storage.SharedDir) == "" {
		return nil, fmt.Errorf("storage.shared_dir is required")
	}
	if cfg.Buffer.DurationSec <= 0 {
		return nil, fmt.Errorf("buffer.duration_sec must be greater than 0")
	}
	if cfg.Buffer.PollIntervalMs <= 0 {
		return nil, fmt.Errorf("buffer.poll_interval_ms must be greater than 0")
	}
	if cfg.Buffer.MaxFramesPerCamera <= 0 {
		return nil, fmt.Errorf("buffer.max_frames_per_camera must be greater than 0")
	}
	if cfg.Buffer.MaxBytesPerCamera <= 0 {
		return nil, fmt.Errorf("buffer.max_bytes_per_camera must be greater than 0")
	}
	if cfg.Buffer.StatusReportIntervalSec <= 0 {
		return nil, fmt.Errorf("buffer.status_report_interval_sec must be greater than 0")
	}
	if cfg.Queue.MaxPending <= 0 {
		return nil, fmt.Errorf("queue.max_pending must be greater than 0")
	}
	if cfg.Queue.WorkerCount <= 0 {
		return nil, fmt.Errorf("queue.worker_count must be greater than 0")
	}
	if cfg.Recording.DefaultFrameRate <= 0 {
		return nil, fmt.Errorf("recording.default_frame_rate must be greater than 0")
	}
	if cfg.Recording.MaxFrameRate < cfg.Recording.DefaultFrameRate {
		cfg.Recording.MaxFrameRate = cfg.Recording.DefaultFrameRate
	}
	if cfg.Recording.DefaultPreSec < 0 {
		return nil, fmt.Errorf("recording.default_pre_sec must be >= 0")
	}
	if cfg.Recording.DefaultPostSec < 0 {
		return nil, fmt.Errorf("recording.default_post_sec must be >= 0")
	}
	if cfg.Recording.WriteTimeoutSec <= 0 {
		return nil, fmt.Errorf("recording.write_timeout_sec must be greater than 0")
	}
	if strings.TrimSpace(cfg.Recording.GStreamerBin) == "" {
		cfg.Recording.GStreamerBin = "gst-launch-1.0"
	}
	if strings.TrimSpace(cfg.Upload.ServiceName) == "" {
		cfg.Upload.ServiceName = "cloud-transfer"
	}
	if len(raw.Cameras) == 0 {
		return nil, fmt.Errorf("at least one camera must be configured")
	}

	for _, rawCamera := range raw.Cameras {
		cameraID := strings.TrimSpace(fmt.Sprint(rawCamera.ID))
		if cameraID == "" || cameraID == "<nil>" {
			return nil, fmt.Errorf("camera id is required")
		}
		camera := CameraConfig{
			Enabled: true,
			ID:      cameraID,
			Height:  rawCamera.Height,
			Name:    strings.TrimSpace(rawCamera.Name),
			Width:   rawCamera.Width,
		}
		if rawCamera.Enabled != nil {
			camera.Enabled = *rawCamera.Enabled
		}
		if camera.Name == "" {
			return nil, fmt.Errorf("camera %s is missing name", camera.ID)
		}
		if camera.Width <= 0 || camera.Height <= 0 {
			return nil, fmt.Errorf("camera %s has invalid resolution %dx%d", camera.Name, camera.Width, camera.Height)
		}
		cfg.Cameras = append(cfg.Cameras, camera)
	}

	return cfg, nil
}
