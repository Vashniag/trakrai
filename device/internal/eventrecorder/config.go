package eventrecorder

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/livefeed"
	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "event-recorder"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type SamplingConfig struct {
	Backend      string `json:"backend"`
	FrameSource  string `json:"frame_source"`
	MaxBufferSec int    `json:"max_buffer_sec"`
	SampleFPS    int    `json:"sample_fps"`
	SpoolDir     string `json:"spool_dir"`
}

type OutputConfig struct {
	ClipsSubdir string `json:"clips_subdir"`
	Encoder     string `json:"encoder"`
	FilesRoot   string `json:"files_root"`
	JPEGQuality int    `json:"jpeg_quality"`
	PlaybackFPS int    `json:"playback_fps"`
	StagingDir  string `json:"staging_dir"`
}

type WorkflowQueueConfig struct {
	Enabled     bool               `json:"enabled"`
	PendingList string             `json:"pending_list"`
	Redis       redisconfig.Config `json:"redis"`
}

type CameraConfig struct {
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
}

type Config struct {
	Cameras       []CameraConfig           `json:"cameras"`
	Composite     livefeed.CompositeConfig `json:"composite"`
	IPC           IPCConfig                `json:"ipc"`
	LogLevel      string                   `json:"log_level"`
	Output        OutputConfig             `json:"output"`
	Redis         redisconfig.Config       `json:"redis"`
	Sampling      SamplingConfig           `json:"sampling"`
	WorkflowQueue WorkflowQueueConfig      `json:"workflow_queue"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		IPC:      IPCConfig{SocketPath: "/tmp/trakrai-cloud-comm.sock"},
		Redis: redisconfig.Config{
			Host:      "localhost",
			Port:      6379,
			DB:        0,
			KeyPrefix: "camera",
		},
		Sampling: SamplingConfig{
			Backend:      "redis",
			FrameSource:  "both",
			MaxBufferSec: 900,
			SampleFPS:    1,
			SpoolDir:     "/data/trakrai-recordings/ring",
		},
		Output: OutputConfig{
			ClipsSubdir: "recordings",
			Encoder:     "auto",
			FilesRoot:   "/var/lib/trakrai/workflow-comm/files",
			JPEGQuality: 85,
			PlaybackFPS: 24,
			StagingDir:  "/data/trakrai-recordings/staging",
		},
		WorkflowQueue: WorkflowQueueConfig{
			Enabled:     false,
			PendingList: "workflow:cloud:pending",
			Redis: redisconfig.Config{
				Host:      "localhost",
				Port:      6379,
				DB:        0,
				KeyPrefix: "workflow",
			},
		},
		Composite: livefeed.CompositeConfig{
			Width:       960,
			Height:      540,
			TilePadding: 8,
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")
	cfg.WorkflowQueue.Redis = redisconfig.WithDefaults(cfg.WorkflowQueue.Redis, "workflow")

	if strings.TrimSpace(cfg.LogLevel) == "" {
		cfg.LogLevel = "info"
	}
	if strings.TrimSpace(cfg.IPC.SocketPath) == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}

	switch strings.TrimSpace(cfg.Sampling.FrameSource) {
	case "", "both":
		cfg.Sampling.FrameSource = "both"
	case string(livefeed.LiveFrameSourceProcessed), string(livefeed.LiveFrameSourceRaw):
	default:
		return nil, fmt.Errorf("sampling.frame_source must be raw, processed, or both")
	}
	switch strings.TrimSpace(cfg.Sampling.Backend) {
	case "", "redis":
		cfg.Sampling.Backend = "redis"
	case "spool":
	default:
		return nil, fmt.Errorf("sampling.backend must be redis or spool")
	}

	if cfg.Sampling.SampleFPS <= 0 {
		return nil, fmt.Errorf("sampling.sample_fps must be greater than 0")
	}
	if cfg.Sampling.MaxBufferSec < cfg.Sampling.SampleFPS {
		return nil, fmt.Errorf("sampling.max_buffer_sec must be >= sampling.sample_fps")
	}
	if strings.TrimSpace(cfg.Sampling.SpoolDir) == "" {
		return nil, fmt.Errorf("sampling.spool_dir is required")
	}

	switch strings.TrimSpace(cfg.Output.Encoder) {
	case "", "auto", "hardware", "software":
	default:
		return nil, fmt.Errorf("output.encoder must be auto, hardware, or software")
	}
	if cfg.Output.PlaybackFPS <= 0 {
		return nil, fmt.Errorf("output.playback_fps must be greater than 0")
	}
	if cfg.Output.JPEGQuality < 1 || cfg.Output.JPEGQuality > 100 {
		return nil, fmt.Errorf("output.jpeg_quality must be between 1 and 100")
	}
	if strings.TrimSpace(cfg.Output.FilesRoot) == "" {
		return nil, fmt.Errorf("output.files_root is required")
	}
	if strings.TrimSpace(cfg.Output.ClipsSubdir) == "" {
		cfg.Output.ClipsSubdir = "recordings"
	}
	if strings.TrimSpace(cfg.Output.StagingDir) == "" {
		return nil, fmt.Errorf("output.staging_dir is required")
	}

	cfg.Sampling.SpoolDir = filepath.Clean(cfg.Sampling.SpoolDir)
	cfg.Output.FilesRoot = filepath.Clean(cfg.Output.FilesRoot)
	cfg.Output.ClipsSubdir = filepath.Clean(cfg.Output.ClipsSubdir)
	cfg.Output.StagingDir = filepath.Clean(cfg.Output.StagingDir)

	if err := os.MkdirAll(cfg.Sampling.SpoolDir, 0o755); err != nil {
		return nil, fmt.Errorf("create spool dir: %w", err)
	}
	if err := os.MkdirAll(cfg.Output.FilesRoot, 0o755); err != nil {
		return nil, fmt.Errorf("create files root: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(cfg.Output.FilesRoot, cfg.Output.ClipsSubdir), 0o755); err != nil {
		return nil, fmt.Errorf("create clip output dir: %w", err)
	}
	if err := os.MkdirAll(cfg.Output.StagingDir, 0o755); err != nil {
		return nil, fmt.Errorf("create staging dir: %w", err)
	}

	if cfg.Composite.Width <= 0 || cfg.Composite.Height <= 0 {
		return nil, fmt.Errorf("composite dimensions must be greater than 0")
	}
	if cfg.Composite.TilePadding < 0 {
		return nil, fmt.Errorf("composite.tile_padding must be zero or greater")
	}

	enabledCameras := make([]CameraConfig, 0, len(cfg.Cameras))
	seen := make(map[string]struct{}, len(cfg.Cameras))
	for _, camera := range cfg.Cameras {
		name := strings.TrimSpace(camera.Name)
		if name == "" {
			return nil, fmt.Errorf("camera name is required")
		}
		if _, ok := seen[name]; ok {
			return nil, fmt.Errorf("duplicate camera %q", name)
		}
		seen[name] = struct{}{}
		if !camera.Enabled {
			continue
		}
		enabledCameras = append(enabledCameras, CameraConfig{Enabled: true, Name: name})
	}
	if len(enabledCameras) == 0 {
		return nil, fmt.Errorf("at least one enabled camera is required")
	}
	cfg.Cameras = enabledCameras

	if cfg.WorkflowQueue.Enabled && strings.TrimSpace(cfg.WorkflowQueue.PendingList) == "" {
		return nil, fmt.Errorf("workflow_queue.pending_list is required when workflow_queue.enabled=true")
	}

	return cfg, nil
}
