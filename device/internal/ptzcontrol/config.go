package ptzcontrol

import (
	"fmt"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

const ServiceName = "ptz-control"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type MoveDefaults struct {
	AbsoluteSpeed float64 `json:"absolute_speed"`
	PanTiltSpeed  float64 `json:"pan_tilt_speed"`
	ZoomSpeed     float64 `json:"zoom_speed"`
}

type HomePosition struct {
	Pan  float64 `json:"pan"`
	Tilt float64 `json:"tilt"`
	Zoom float64 `json:"zoom"`
}

type rawCameraConfig struct {
	Name         string        `json:"name"`
	Driver       string        `json:"driver,omitempty"`
	Address      string        `json:"address"`
	OnvifPort    int           `json:"onvif_port"`
	Username     string        `json:"username"`
	Password     string        `json:"password"`
	ProfileToken string        `json:"profile_token,omitempty"`
	Enabled      *bool         `json:"enabled,omitempty"`
	Home         *HomePosition `json:"home,omitempty"`
}

type rawConfig struct {
	LogLevel string            `json:"log_level"`
	IPC      IPCConfig         `json:"ipc"`
	Defaults MoveDefaults      `json:"defaults"`
	Cameras  []rawCameraConfig `json:"cameras"`
}

type CameraConfig struct {
	Name         string
	Driver       string
	Address      string
	OnvifPort    int
	Username     string
	Password     string
	ProfileToken string
	Enabled      bool
	Home         *HomePosition
}

type Config struct {
	LogLevel string
	IPC      IPCConfig
	Defaults MoveDefaults
	Cameras  []CameraConfig
}

func LoadConfig(path string) (*Config, error) {
	raw := rawConfig{
		LogLevel: "info",
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Defaults: MoveDefaults{
			AbsoluteSpeed: 0.8,
			PanTiltSpeed:  0.55,
			ZoomSpeed:     0.45,
		},
	}

	if err := configjson.Load(path, &raw); err != nil {
		return nil, err
	}

	if raw.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}

	cfg := &Config{
		LogLevel: raw.LogLevel,
		IPC:      raw.IPC,
		Defaults: applyDefaults(raw.Defaults),
	}

	for _, rawCamera := range raw.Cameras {
		camera := resolveCamera(rawCamera)
		if !camera.Enabled {
			continue
		}
		if err := validateCamera(camera); err != nil {
			return nil, fmt.Errorf("camera %q: %w", rawCamera.Name, err)
		}
		cfg.Cameras = append(cfg.Cameras, camera)
	}

	if len(cfg.Cameras) == 0 {
		return nil, fmt.Errorf("no enabled PTZ cameras defined in config")
	}

	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}

	return cfg, nil
}

func applyDefaults(defaults MoveDefaults) MoveDefaults {
	if defaults.AbsoluteSpeed <= 0 {
		defaults.AbsoluteSpeed = 0.8
	}
	if defaults.PanTiltSpeed <= 0 {
		defaults.PanTiltSpeed = 0.55
	}
	if defaults.ZoomSpeed <= 0 {
		defaults.ZoomSpeed = 0.45
	}

	return defaults
}

func resolveCamera(rawCamera rawCameraConfig) CameraConfig {
	enabled := true
	if rawCamera.Enabled != nil {
		enabled = *rawCamera.Enabled
	}
	port := rawCamera.OnvifPort
	if port == 0 {
		port = 80
	}

	return CameraConfig{
		Name:         rawCamera.Name,
		Driver:       resolveDriver(rawCamera.Driver),
		Address:      rawCamera.Address,
		OnvifPort:    port,
		Username:     rawCamera.Username,
		Password:     rawCamera.Password,
		ProfileToken: rawCamera.ProfileToken,
		Enabled:      enabled,
		Home:         rawCamera.Home,
	}
}

func resolveDriver(driver string) string {
	switch driver {
	case "", "onvif":
		return "onvif"
	case "mock":
		return "mock"
	default:
		return driver
	}
}

func validateCamera(camera CameraConfig) error {
	if camera.Name == "" {
		return fmt.Errorf("missing name")
	}
	if camera.Driver != "onvif" && camera.Driver != "mock" {
		return fmt.Errorf("unsupported driver %q", camera.Driver)
	}
	if camera.Driver == "mock" {
		return nil
	}
	if camera.Address == "" {
		return fmt.Errorf("missing address")
	}
	if camera.OnvifPort <= 0 {
		return fmt.Errorf("invalid onvif_port %d", camera.OnvifPort)
	}
	if camera.Username == "" {
		return fmt.Errorf("missing username")
	}
	if camera.Password == "" {
		return fmt.Errorf("missing password")
	}

	return nil
}
