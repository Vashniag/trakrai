package rtspfeeder

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type CameraDefaults struct {
	CaptureMethod     string  `json:"capture_method"`
	Width             int     `json:"width"`
	Height            int     `json:"height"`
	Framerate         float64 `json:"framerate"`
	JPEGQuality       int     `json:"jpeg_quality"`
	LatencyMS         int     `json:"latency_ms"`
	Protocols         string  `json:"protocols"`
	ReconnectDelaySec int     `json:"reconnect_delay_sec"`
	Rotate180         bool    `json:"rotate_180"`
	SaveFrames        bool    `json:"save_frames"`
	SavePath          string  `json:"save_path"`
	PipelineTimeout   int     `json:"pipeline_timeout_sec"`
}

type rawCamera struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	RTSPURL string `json:"rtsp_url"`
	Enabled *bool  `json:"enabled"`

	CaptureMethod     string   `json:"capture_method,omitempty"`
	Width             *int     `json:"width,omitempty"`
	Height            *int     `json:"height,omitempty"`
	Framerate         *float64 `json:"framerate,omitempty"`
	JPEGQuality       *int     `json:"jpeg_quality,omitempty"`
	LatencyMS         *int     `json:"latency_ms,omitempty"`
	Protocols         *string  `json:"protocols,omitempty"`
	ReconnectDelaySec *int     `json:"reconnect_delay_sec,omitempty"`
	Rotate180         *bool    `json:"rotate_180,omitempty"`
	SaveFrames        *bool    `json:"save_frames,omitempty"`
	SavePath          *string  `json:"save_path,omitempty"`
	PipelineTimeout   *int     `json:"pipeline_timeout_sec,omitempty"`
}

type rawConfig struct {
	LogLevel string             `json:"log_level"`
	Redis    redisconfig.Config `json:"redis"`
	Defaults CameraDefaults     `json:"defaults"`
	Cameras  []rawCamera        `json:"cameras"`
}

type CameraConfig struct {
	ID                int
	Name              string
	RTSPURL           string
	Enabled           bool
	CaptureMethod     string
	Width             int
	Height            int
	Framerate         float64
	JPEGQuality       int
	LatencyMS         int
	Protocols         string
	ReconnectDelaySec int
	Rotate180         bool
	SaveFrames        bool
	SavePath          string
	PipelineTimeout   int
}

type Config struct {
	LogLevel string
	Redis    redisconfig.Config
	Cameras  []CameraConfig
}

func LoadConfig(path string) (*Config, error) {
	var raw rawConfig
	if err := configjson.Load(path, &raw); err != nil {
		return nil, err
	}

	defaults := applyGlobalDefaults(raw.Defaults)
	cfg := &Config{
		LogLevel: raw.LogLevel,
		Redis:    redisconfig.WithDefaults(raw.Redis, "camera"),
	}

	for _, rawCamera := range raw.Cameras {
		camera := resolveCamera(rawCamera, defaults)
		if err := validateCamera(camera); err != nil {
			return nil, fmt.Errorf("camera %q: %w", camera.Name, err)
		}
		cfg.Cameras = append(cfg.Cameras, camera)
	}

	if len(cfg.Cameras) == 0 {
		return nil, fmt.Errorf("no cameras defined in config")
	}

	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}

	return cfg, nil
}

func applyGlobalDefaults(defaults CameraDefaults) CameraDefaults {
	if defaults.CaptureMethod == "" {
		defaults.CaptureMethod = "auto"
	}
	if defaults.Width == 0 {
		defaults.Width = 640
	}
	if defaults.Height == 0 {
		defaults.Height = 480
	}
	if defaults.Framerate == 0 {
		defaults.Framerate = 2
	}
	if defaults.JPEGQuality == 0 {
		defaults.JPEGQuality = 85
	}
	if defaults.LatencyMS == 0 {
		defaults.LatencyMS = 200
	}
	if defaults.Protocols == "" {
		defaults.Protocols = "tcp"
	}
	if defaults.ReconnectDelaySec == 0 {
		defaults.ReconnectDelaySec = 5
	}
	if defaults.SavePath == "" {
		defaults.SavePath = "/data/raw"
	}
	if defaults.PipelineTimeout == 0 {
		defaults.PipelineTimeout = 15
	}
	return defaults
}

func resolveCamera(rawCamera rawCamera, defaults CameraDefaults) CameraConfig {
	camera := CameraConfig{
		ID:                rawCamera.ID,
		Name:              rawCamera.Name,
		RTSPURL:           rawCamera.RTSPURL,
		Enabled:           true,
		CaptureMethod:     defaults.CaptureMethod,
		Width:             defaults.Width,
		Height:            defaults.Height,
		Framerate:         defaults.Framerate,
		JPEGQuality:       defaults.JPEGQuality,
		LatencyMS:         defaults.LatencyMS,
		Protocols:         defaults.Protocols,
		ReconnectDelaySec: defaults.ReconnectDelaySec,
		Rotate180:         defaults.Rotate180,
		SaveFrames:        defaults.SaveFrames,
		SavePath:          defaults.SavePath,
		PipelineTimeout:   defaults.PipelineTimeout,
	}

	if rawCamera.Enabled != nil {
		camera.Enabled = *rawCamera.Enabled
	}
	if rawCamera.CaptureMethod != "" {
		camera.CaptureMethod = rawCamera.CaptureMethod
	}
	if rawCamera.Width != nil {
		camera.Width = *rawCamera.Width
	}
	if rawCamera.Height != nil {
		camera.Height = *rawCamera.Height
	}
	if rawCamera.Framerate != nil {
		camera.Framerate = *rawCamera.Framerate
	}
	if rawCamera.JPEGQuality != nil {
		camera.JPEGQuality = *rawCamera.JPEGQuality
	}
	if rawCamera.LatencyMS != nil {
		camera.LatencyMS = *rawCamera.LatencyMS
	}
	if rawCamera.Protocols != nil {
		camera.Protocols = *rawCamera.Protocols
	}
	if rawCamera.ReconnectDelaySec != nil {
		camera.ReconnectDelaySec = *rawCamera.ReconnectDelaySec
	}
	if rawCamera.Rotate180 != nil {
		camera.Rotate180 = *rawCamera.Rotate180
	}
	if rawCamera.SaveFrames != nil {
		camera.SaveFrames = *rawCamera.SaveFrames
	}
	if rawCamera.SavePath != nil {
		camera.SavePath = *rawCamera.SavePath
	}
	if rawCamera.PipelineTimeout != nil {
		camera.PipelineTimeout = *rawCamera.PipelineTimeout
	}

	return camera
}

func validateCamera(camera CameraConfig) error {
	if camera.Name == "" {
		return fmt.Errorf("missing name")
	}
	if camera.RTSPURL == "" {
		return fmt.Errorf("missing rtsp_url")
	}
	if camera.Width <= 0 || camera.Height <= 0 {
		return fmt.Errorf("invalid resolution %dx%d", camera.Width, camera.Height)
	}
	if camera.Framerate <= 0 {
		return fmt.Errorf("invalid framerate %f", camera.Framerate)
	}
	if camera.JPEGQuality < 1 || camera.JPEGQuality > 100 {
		return fmt.Errorf("jpeg_quality must be 1-100, got %d", camera.JPEGQuality)
	}

	switch camera.CaptureMethod {
	case "auto", "h265_hw", "h264_hw", "software":
		return nil
	default:
		return fmt.Errorf("unknown capture_method %q (use auto, h265_hw, h264_hw, or software)", camera.CaptureMethod)
	}
}
