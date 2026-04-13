package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// RedisConfig holds Redis connection parameters.
type RedisConfig struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Password  string `json:"password"`
	DB        int    `json:"db"`
	KeyPrefix string `json:"key_prefix"`
}

// CameraDefaults provides default values for camera parameters.
// Individual cameras can override any of these.
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

// rawCamera is the JSON-level camera entry. Pointer fields distinguish
// "not set" (nil) from an explicit zero/false value.
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
	LogLevel string         `json:"log_level"`
	Redis    RedisConfig    `json:"redis"`
	Defaults CameraDefaults `json:"defaults"`
	Cameras  []rawCamera    `json:"cameras"`
}

// CameraConfig is the fully-resolved configuration for one camera.
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

// Config is the top-level resolved configuration.
type Config struct {
	LogLevel string
	Redis    RedisConfig
	Cameras  []CameraConfig
}

// LoadConfig reads and parses the JSON config file, applying defaults.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	var raw rawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	d := applyGlobalDefaults(raw.Defaults)
	r := applyRedisDefaults(raw.Redis)

	cfg := &Config{
		LogLevel: raw.LogLevel,
		Redis:    r,
	}

	for _, rc := range raw.Cameras {
		cam := resolveCamera(rc, d)
		if err := validateCamera(cam); err != nil {
			return nil, fmt.Errorf("camera %q: %w", cam.Name, err)
		}
		cfg.Cameras = append(cfg.Cameras, cam)
	}

	if len(cfg.Cameras) == 0 {
		return nil, fmt.Errorf("no cameras defined in config")
	}

	return cfg, nil
}

func applyGlobalDefaults(d CameraDefaults) CameraDefaults {
	if d.CaptureMethod == "" {
		d.CaptureMethod = "auto"
	}
	if d.Width == 0 {
		d.Width = 640
	}
	if d.Height == 0 {
		d.Height = 480
	}
	if d.Framerate == 0 {
		d.Framerate = 2
	}
	if d.JPEGQuality == 0 {
		d.JPEGQuality = 85
	}
	if d.LatencyMS == 0 {
		d.LatencyMS = 200
	}
	if d.Protocols == "" {
		d.Protocols = "tcp"
	}
	if d.ReconnectDelaySec == 0 {
		d.ReconnectDelaySec = 5
	}
	if d.SavePath == "" {
		d.SavePath = "/data/raw"
	}
	if d.PipelineTimeout == 0 {
		d.PipelineTimeout = 15
	}
	return d
}

func applyRedisDefaults(r RedisConfig) RedisConfig {
	if r.Host == "" {
		r.Host = "localhost"
	}
	if r.Port == 0 {
		r.Port = 6379
	}
	if r.KeyPrefix == "" {
		r.KeyPrefix = "camera"
	}
	return r
}

func resolveCamera(rc rawCamera, d CameraDefaults) CameraConfig {
	cam := CameraConfig{
		ID:                rc.ID,
		Name:              rc.Name,
		RTSPURL:           rc.RTSPURL,
		Enabled:           true,
		CaptureMethod:     d.CaptureMethod,
		Width:             d.Width,
		Height:            d.Height,
		Framerate:         d.Framerate,
		JPEGQuality:       d.JPEGQuality,
		LatencyMS:         d.LatencyMS,
		Protocols:         d.Protocols,
		ReconnectDelaySec: d.ReconnectDelaySec,
		Rotate180:         d.Rotate180,
		SaveFrames:        d.SaveFrames,
		SavePath:          d.SavePath,
		PipelineTimeout:   d.PipelineTimeout,
	}

	if rc.Enabled != nil {
		cam.Enabled = *rc.Enabled
	}
	if rc.CaptureMethod != "" {
		cam.CaptureMethod = rc.CaptureMethod
	}
	if rc.Width != nil {
		cam.Width = *rc.Width
	}
	if rc.Height != nil {
		cam.Height = *rc.Height
	}
	if rc.Framerate != nil {
		cam.Framerate = *rc.Framerate
	}
	if rc.JPEGQuality != nil {
		cam.JPEGQuality = *rc.JPEGQuality
	}
	if rc.LatencyMS != nil {
		cam.LatencyMS = *rc.LatencyMS
	}
	if rc.Protocols != nil {
		cam.Protocols = *rc.Protocols
	}
	if rc.ReconnectDelaySec != nil {
		cam.ReconnectDelaySec = *rc.ReconnectDelaySec
	}
	if rc.Rotate180 != nil {
		cam.Rotate180 = *rc.Rotate180
	}
	if rc.SaveFrames != nil {
		cam.SaveFrames = *rc.SaveFrames
	}
	if rc.SavePath != nil {
		cam.SavePath = *rc.SavePath
	}
	if rc.PipelineTimeout != nil {
		cam.PipelineTimeout = *rc.PipelineTimeout
	}
	return cam
}

func validateCamera(cam CameraConfig) error {
	if cam.Name == "" {
		return fmt.Errorf("missing name")
	}
	if cam.RTSPURL == "" {
		return fmt.Errorf("missing rtsp_url")
	}
	if cam.Width <= 0 || cam.Height <= 0 {
		return fmt.Errorf("invalid resolution %dx%d", cam.Width, cam.Height)
	}
	if cam.Framerate <= 0 {
		return fmt.Errorf("invalid framerate %f", cam.Framerate)
	}
	if cam.JPEGQuality < 1 || cam.JPEGQuality > 100 {
		return fmt.Errorf("jpeg_quality must be 1-100, got %d", cam.JPEGQuality)
	}
	switch cam.CaptureMethod {
	case "auto", "h265_hw", "h264_hw", "software":
	default:
		return fmt.Errorf("unknown capture_method %q (use auto, h265_hw, h264_hw, or software)", cam.CaptureMethod)
	}
	return nil
}
