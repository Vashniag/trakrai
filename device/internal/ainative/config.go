package ainative

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "ai-inference-native"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type BackendConfig struct {
	Command           []string `json:"command"`
	Mode              string   `json:"mode"`
	ResponseTimeoutMs int      `json:"response_timeout_ms"`
	RestartDelayMs    int      `json:"restart_delay_ms"`
}

type InferenceConfig struct {
	IdleSleepMs           int     `json:"idle_sleep_ms"`
	IOUThreshold          float64 `json:"iou_threshold"`
	PollIntervalMs        int     `json:"poll_interval_ms"`
	ProcessedImagesMaxLen int     `json:"processed_images_maxlen"`
}

type StagingConfig struct {
	Dir                string `json:"dir"`
	RetainAnnotatedJPG bool   `json:"retain_annotated_jpg"`
	RetainInputJPG     bool   `json:"retain_input_jpg"`
}

type CameraConfig struct {
	Enabled bool   `json:"enabled"`
	ID      int    `json:"id"`
	Name    string `json:"name"`
}

type Config struct {
	Backend   BackendConfig      `json:"backend"`
	Cameras   []CameraConfig     `json:"cameras"`
	IPC       IPCConfig          `json:"ipc"`
	Inference InferenceConfig    `json:"inference"`
	LogLevel  string             `json:"log_level"`
	Redis     redisconfig.Config `json:"redis"`
	Staging   StagingConfig      `json:"staging"`
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
		Backend: BackendConfig{
			Mode:              "process",
			ResponseTimeoutMs: 5000,
			RestartDelayMs:    1000,
		},
		Inference: InferenceConfig{
			IdleSleepMs:           40,
			IOUThreshold:          0.45,
			PollIntervalMs:        5,
			ProcessedImagesMaxLen: 10,
		},
		Staging: StagingConfig{
			Dir: filepath.Join(os.TempDir(), "trakrai-ai-native"),
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")
	if strings.TrimSpace(cfg.LogLevel) == "" {
		cfg.LogLevel = "info"
	}
	if strings.TrimSpace(cfg.IPC.SocketPath) == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	switch strings.TrimSpace(cfg.Backend.Mode) {
	case "", "process", "mock":
		if strings.TrimSpace(cfg.Backend.Mode) == "" {
			cfg.Backend.Mode = "process"
		}
	default:
		return nil, fmt.Errorf("backend.mode must be process or mock")
	}
	if cfg.Backend.Mode == "process" && len(cfg.Backend.Command) == 0 {
		return nil, fmt.Errorf("backend.command is required in process mode")
	}
	if cfg.Backend.ResponseTimeoutMs <= 0 {
		return nil, fmt.Errorf("backend.response_timeout_ms must be greater than 0")
	}
	if cfg.Backend.RestartDelayMs <= 0 {
		cfg.Backend.RestartDelayMs = 1000
	}

	if cfg.Inference.PollIntervalMs <= 0 {
		return nil, fmt.Errorf("inference.poll_interval_ms must be greater than 0")
	}
	if cfg.Inference.IdleSleepMs <= 0 {
		return nil, fmt.Errorf("inference.idle_sleep_ms must be greater than 0")
	}
	if cfg.Inference.ProcessedImagesMaxLen <= 0 {
		return nil, fmt.Errorf("inference.processed_images_maxlen must be greater than 0")
	}

	cfg.Staging.Dir = filepath.Clean(strings.TrimSpace(cfg.Staging.Dir))
	if cfg.Staging.Dir == "" {
		return nil, fmt.Errorf("staging.dir is required")
	}
	if err := os.MkdirAll(cfg.Staging.Dir, 0o755); err != nil {
		return nil, fmt.Errorf("create staging dir: %w", err)
	}

	enabledCameras := make([]CameraConfig, 0, len(cfg.Cameras))
	seenIDs := make(map[int]struct{}, len(cfg.Cameras))
	seenNames := make(map[string]struct{}, len(cfg.Cameras))
	for _, camera := range cfg.Cameras {
		if camera.ID <= 0 {
			return nil, fmt.Errorf("camera id must be greater than 0")
		}
		name := strings.TrimSpace(camera.Name)
		if name == "" {
			return nil, fmt.Errorf("camera name is required")
		}
		if _, ok := seenIDs[camera.ID]; ok {
			return nil, fmt.Errorf("duplicate camera id %d", camera.ID)
		}
		if _, ok := seenNames[name]; ok {
			return nil, fmt.Errorf("duplicate camera name %q", name)
		}
		seenIDs[camera.ID] = struct{}{}
		seenNames[name] = struct{}{}
		if !camera.Enabled {
			continue
		}
		enabledCameras = append(enabledCameras, CameraConfig{Enabled: true, ID: camera.ID, Name: name})
	}
	if len(enabledCameras) == 0 {
		return nil, fmt.Errorf("at least one enabled camera is required")
	}
	cfg.Cameras = enabledCameras

	return cfg, nil
}
