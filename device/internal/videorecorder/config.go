package videorecorder

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/generatedconfig"
	"github.com/trakrai/device-services/internal/gstcodec"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "video-recorder"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type StorageConfig struct {
	BufferDir string `json:"buffer_dir"`
	SharedDir string `json:"shared_dir"`
}

type BufferConfig struct {
	DurationSec             int `json:"duration_sec"`
	MaxBytesPerCamera       int `json:"max_bytes_per_camera"`
	MaxFramesPerCamera      int `json:"max_frames_per_camera"`
	MaxSegmentBytes         int `json:"max_segment_bytes"`
	PollIntervalMs          int `json:"poll_interval_ms"`
	StatusReportIntervalSec int `json:"status_report_interval_sec"`
}

type QueueConfig struct {
	MaxPending  int `json:"max_pending"`
	WorkerCount int `json:"worker_count"`
}

type RecordingConfig struct {
	DefaultCodec     string `json:"default_codec"`
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
	raw, err := generatedconfig.LoadVideoRecorderConfig(path)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Buffer: BufferConfig{
			DurationSec:             raw.Buffer.DurationSec,
			MaxBytesPerCamera:       raw.Buffer.MaxBytesPerCamera,
			MaxFramesPerCamera:      raw.Buffer.MaxFramesPerCamera,
			MaxSegmentBytes:         raw.Buffer.MaxSegmentBytes,
			PollIntervalMs:          raw.Buffer.PollIntervalMs,
			StatusReportIntervalSec: raw.Buffer.StatusReportIntervalSec,
		},
		DeviceID: strings.TrimSpace(raw.DeviceId),
		IPC: IPCConfig{
			SocketPath: raw.Ipc.SocketPath,
		},
		LogLevel: strings.TrimSpace(raw.LogLevel),
		Queue: QueueConfig{
			MaxPending:  raw.Queue.MaxPending,
			WorkerCount: raw.Queue.WorkerCount,
		},
		Recording: RecordingConfig{
			DefaultCodec:     raw.Recording.DefaultCodec,
			DefaultFrameRate: raw.Recording.DefaultFrameRate,
			DefaultPostSec:   raw.Recording.DefaultPostSec,
			DefaultPreSec:    raw.Recording.DefaultPreSec,
			GStreamerBin:     raw.Recording.GstreamerBin,
			MaxFrameRate:     raw.Recording.MaxFrameRate,
			WriteTimeoutSec:  raw.Recording.WriteTimeoutSec,
		},
		Redis: redisconfig.WithDefaults(
			redisconfig.Config{
				Host:      raw.Redis.Host,
				Port:      raw.Redis.Port,
				Password:  raw.Redis.Password,
				DB:        raw.Redis.Db,
				KeyPrefix: raw.Redis.KeyPrefix,
			},
			"camera",
		),
		Storage: StorageConfig{
			BufferDir: raw.Storage.BufferDir,
			SharedDir: raw.Storage.SharedDir,
		},
		Upload: UploadConfig{
			ServiceName: raw.Upload.ServiceName,
		},
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
	if strings.TrimSpace(cfg.Storage.BufferDir) == "" {
		cfg.Storage.BufferDir = filepath.Join(cfg.Storage.SharedDir, ".video-recorder-buffer")
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
	if cfg.Buffer.MaxSegmentBytes <= 0 {
		return nil, fmt.Errorf("buffer.max_segment_bytes must be greater than 0")
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
	cfg.Recording.DefaultCodec = string(gstcodec.NormalizeVideoCodec(cfg.Recording.DefaultCodec))
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
		cameraID := strings.TrimSpace(fmt.Sprint(rawCamera.Id))
		if cameraID == "" || cameraID == "<nil>" {
			return nil, fmt.Errorf("camera id is required")
		}
		camera := CameraConfig{
			Enabled: rawCamera.Enabled,
			ID:      cameraID,
			Height:  rawCamera.Height,
			Name:    strings.TrimSpace(rawCamera.Name),
			Width:   rawCamera.Width,
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
