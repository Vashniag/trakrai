package ptzcontrol

import (
	"fmt"

	"github.com/trakrai/device-services/internal/generatedconfig"
)

const ServiceName = "ptz-control"

type IPCConfig = generatedconfig.PtzControlConfigIpc
type MoveDefaults = generatedconfig.PtzControlConfigDefaults
type HomePosition = generatedconfig.PtzControlConfigCamerasItemHome
type CameraConfig = generatedconfig.PtzControlConfigCamerasItem
type Config = generatedconfig.PtzControlConfig

func LoadConfig(path string) (*Config, error) {
	cfg, err := generatedconfig.LoadPtzControlConfig(path)
	if err != nil {
		return nil, err
	}

	if cfg.Ipc.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}

	cfg.Defaults = applyDefaults(cfg.Defaults)
	resolved := make([]CameraConfig, 0, len(cfg.Cameras))
	for _, rawCamera := range cfg.Cameras {
		camera := resolveCamera(rawCamera)
		if !camera.Enabled {
			continue
		}
		if err := validateCamera(camera); err != nil {
			return nil, fmt.Errorf("camera %q: %w", rawCamera.Name, err)
		}
		resolved = append(resolved, camera)
	}
	cfg.Cameras = resolved

	if len(cfg.Cameras) == 0 {
		return nil, fmt.Errorf("no enabled PTZ cameras defined in config")
	}

	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}

	return &cfg, nil
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

func resolveCamera(camera CameraConfig) CameraConfig {
	port := camera.OnvifPort
	if port == 0 {
		port = 80
	}
	camera.Driver = resolveDriver(camera.Driver)
	camera.OnvifPort = port
	return camera
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
