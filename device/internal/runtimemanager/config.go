package runtimemanager

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/trakrai/device-services/internal/generatedconfig"
)

const ServiceName = "runtime-manager"

type IPCConfig = generatedconfig.RuntimeManagerConfigIpc
type SystemdConfig = generatedconfig.RuntimeManagerConfigSystemd
type HTTPConfig = generatedconfig.RuntimeManagerConfigHttp
type RuntimePathsConfig = generatedconfig.RuntimeManagerConfigRuntime
type UpdateConfig = generatedconfig.RuntimeManagerConfigUpdates
type ManagedServiceConfig = generatedconfig.RuntimeManagerConfigServicesItem

type Config struct {
	HTTP     HTTPConfig             `json:"http"`
	IPC      IPCConfig              `json:"ipc"`
	LogLevel string                 `json:"log_level"`
	Runtime  RuntimePathsConfig     `json:"runtime"`
	Services []ManagedServiceConfig `json:"services"`
	Systemd  SystemdConfig          `json:"systemd"`
	Updates  UpdateConfig           `json:"updates"`
}

func LoadConfig(path string) (*Config, error) {
	raw, err := generatedconfig.LoadRuntimeManagerConfig(path)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		LogLevel: raw.LogLevel,
		HTTP: HTTPConfig{
			DownloadTimeoutSec: raw.Http.DownloadTimeoutSec,
		},
		IPC: IPCConfig{
			SocketPath: raw.Ipc.SocketPath,
		},
		Runtime: RuntimePathsConfig{
			BinaryDir:   raw.Runtime.BinaryDir,
			ConfigDir:   raw.Runtime.ConfigDir,
			DownloadDir: raw.Runtime.DownloadDir,
			LogDir:      raw.Runtime.LogDir,
			RootDir:     raw.Runtime.RootDir,
			SharedDir:   raw.Runtime.SharedDir,
			ScriptDir:   raw.Runtime.ScriptDir,
			StateFile:   raw.Runtime.StateFile,
			VersionDir:  raw.Runtime.VersionDir,
		},
		Systemd: SystemdConfig{
			Bin:           raw.Systemd.Bin,
			Shell:         raw.Systemd.Shell,
			UnitDirectory: raw.Systemd.UnitDirectory,
		},
		Updates: UpdateConfig{
			DownloadService: raw.Updates.DownloadService,
			PollIntervalMs:  raw.Updates.PollIntervalMs,
			WaitTimeoutSec:  raw.Updates.WaitTimeoutSec,
		},
	}
	for _, service := range raw.Services {
		cfg.Services = append(
			cfg.Services,
			ManagedServiceConfig{
				After:            append([]string(nil), service.After...),
				AllowControl:     service.AllowControl,
				AllowUpdate:      service.AllowUpdate,
				Core:             service.Core,
				Description:      service.Description,
				DisplayName:      service.DisplayName,
				Enabled:          service.Enabled,
				Environment:      cloneStringMap(service.Environment),
				EnvironmentFiles: append([]string(nil), service.EnvironmentFiles...),
				ExecStart:        append([]string(nil), service.ExecStart...),
				Group:            service.Group,
				InstallPath:      service.InstallPath,
				Kind:             service.Kind,
				LogPath:          service.LogPath,
				Name:             service.Name,
				Requires:         append([]string(nil), service.Requires...),
				Restart:          service.Restart,
				RestartSec:       service.RestartSec,
				ScriptPath:       service.ScriptPath,
				SetupCommand:     append([]string(nil), service.SetupCommand...),
				SystemdUnit:      service.SystemdUnit,
				User:             service.User,
				VersionCommand:   append([]string(nil), service.VersionCommand...),
				VersionFile:      service.VersionFile,
				WantedBy:         service.WantedBy,
				WorkingDirectory: service.WorkingDirectory,
			},
		)
	}

	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.HTTP.DownloadTimeoutSec <= 0 {
		cfg.HTTP.DownloadTimeoutSec = 300
	}
	if cfg.Systemd.Bin == "" {
		cfg.Systemd.Bin = "systemctl"
	}
	if cfg.Systemd.Shell == "" {
		cfg.Systemd.Shell = "/bin/bash"
	}
	if cfg.Systemd.UnitDirectory == "" {
		cfg.Systemd.UnitDirectory = "/etc/systemd/system"
	}

	cfg.Runtime.RootDir = cleanPathWithDefault(cfg.Runtime.RootDir, filepath.Join(os.TempDir(), "trakrai-runtime"))
	if cfg.Runtime.BinaryDir == "" {
		cfg.Runtime.BinaryDir = filepath.Join(cfg.Runtime.RootDir, "bin")
	}
	if cfg.Runtime.ConfigDir == "" {
		cfg.Runtime.ConfigDir = filepath.Join(cfg.Runtime.RootDir, "configs")
	}
	if cfg.Runtime.DownloadDir == "" {
		cfg.Runtime.DownloadDir = filepath.Join(cfg.Runtime.RootDir, "downloads")
	}
	if cfg.Runtime.LogDir == "" {
		cfg.Runtime.LogDir = filepath.Join(cfg.Runtime.RootDir, "logs")
	}
	if cfg.Runtime.SharedDir == "" {
		cfg.Runtime.SharedDir = filepath.Join(cfg.Runtime.RootDir, "shared")
	}
	if cfg.Runtime.ScriptDir == "" {
		cfg.Runtime.ScriptDir = filepath.Join(cfg.Runtime.RootDir, "scripts")
	}
	if cfg.Runtime.StateFile == "" {
		cfg.Runtime.StateFile = filepath.Join(cfg.Runtime.RootDir, "state", "managed-services.json")
	}
	if cfg.Runtime.VersionDir == "" {
		cfg.Runtime.VersionDir = filepath.Join(cfg.Runtime.RootDir, "versions")
	}

	cfg.Runtime.BinaryDir = filepath.Clean(cfg.Runtime.BinaryDir)
	cfg.Runtime.ConfigDir = filepath.Clean(cfg.Runtime.ConfigDir)
	cfg.Runtime.DownloadDir = filepath.Clean(cfg.Runtime.DownloadDir)
	cfg.Runtime.LogDir = filepath.Clean(cfg.Runtime.LogDir)
	cfg.Runtime.ScriptDir = filepath.Clean(cfg.Runtime.ScriptDir)
	cfg.Runtime.SharedDir = filepath.Clean(cfg.Runtime.SharedDir)
	cfg.Runtime.StateFile = filepath.Clean(cfg.Runtime.StateFile)
	cfg.Runtime.VersionDir = filepath.Clean(cfg.Runtime.VersionDir)
	cfg.Systemd.UnitDirectory = filepath.Clean(cfg.Systemd.UnitDirectory)
	if cfg.Updates.DownloadService == "" {
		cfg.Updates.DownloadService = "cloud-transfer"
	}
	if cfg.Updates.PollIntervalMs <= 0 {
		cfg.Updates.PollIntervalMs = 1000
	}
	if cfg.Updates.WaitTimeoutSec <= 0 {
		cfg.Updates.WaitTimeoutSec = 900
	}

	normalizedServices, err := normalizeManagedServices(cfg, cfg.Services)
	if err != nil {
		return nil, err
	}
	cfg.Services = normalizedServices

	return cfg, nil
}

func normalizeManagedServices(cfg *Config, services []ManagedServiceConfig) ([]ManagedServiceConfig, error) {
	normalized := make([]ManagedServiceConfig, 0, len(services))
	seen := make(map[string]struct{}, len(services))

	for index := range services {
		service, err := normalizeManagedService(cfg, services[index])
		if err != nil {
			return nil, fmt.Errorf("services[%d]: %w", index, err)
		}

		key := strings.ToLower(service.Name)
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate managed service %q", service.Name)
		}
		seen[key] = struct{}{}
		normalized = append(normalized, service)
	}

	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].Name < normalized[j].Name
	})

	return normalized, nil
}

func normalizeManagedService(cfg *Config, service ManagedServiceConfig) (ManagedServiceConfig, error) {
	service.Name = strings.TrimSpace(service.Name)
	if service.Name == "" {
		return ManagedServiceConfig{}, fmt.Errorf("name is required")
	}
	if service.DisplayName == "" {
		service.DisplayName = service.Name
	}

	service.Kind = strings.ToLower(strings.TrimSpace(service.Kind))
	if service.Kind == "" {
		service.Kind = "binary"
	}
	switch service.Kind {
	case "asset", "binary", "wheel", "zip":
	default:
		return ManagedServiceConfig{}, fmt.Errorf("kind %q is not supported", service.Kind)
	}

	service.Description = strings.TrimSpace(service.Description)
	service.Group = strings.TrimSpace(service.Group)
	service.InstallPath = cleanOptionalPath(service.InstallPath)
	service.LogPath = cleanOptionalPath(service.LogPath)
	service.Restart = strings.TrimSpace(service.Restart)
	service.ScriptPath = cleanOptionalPath(service.ScriptPath)
	service.SystemdUnit = strings.TrimSpace(service.SystemdUnit)
	service.User = strings.TrimSpace(service.User)
	service.VersionFile = cleanOptionalPath(service.VersionFile)
	service.WantedBy = strings.TrimSpace(service.WantedBy)
	service.WorkingDirectory = cleanOptionalPath(service.WorkingDirectory)
	service.After = cleanStringList(service.After)
	service.EnvironmentFiles = cleanPathList(service.EnvironmentFiles)
	service.ExecStart = cleanStringList(service.ExecStart)
	service.Requires = cleanStringList(service.Requires)
	service.SetupCommand = cleanStringList(service.SetupCommand)
	service.VersionCommand = cleanStringList(service.VersionCommand)
	service.Environment = cleanEnvironmentMap(service.Environment)

	if service.Kind == "binary" && service.InstallPath == "" {
		service.InstallPath = filepath.Join(cfg.Runtime.BinaryDir, service.Name)
	}
	if (service.Kind == "asset" || service.Kind == "zip") && service.InstallPath == "" {
		service.InstallPath = filepath.Join(cfg.Runtime.RootDir, service.Name)
	}

	if len(service.ExecStart) > 0 {
		if service.SystemdUnit == "" {
			service.SystemdUnit = fmt.Sprintf("trakrai-%s.service", service.Name)
		}
		if service.ScriptPath == "" {
			service.ScriptPath = filepath.Join(cfg.Runtime.ScriptDir, fmt.Sprintf("start-%s.sh", service.Name))
		}
		if service.LogPath == "" {
			service.LogPath = filepath.Join(cfg.Runtime.LogDir, service.Name+".log")
		}
		if service.VersionFile == "" {
			service.VersionFile = filepath.Join(cfg.Runtime.VersionDir, service.Name+".txt")
		}
		if service.WorkingDirectory == "" {
			if service.Kind == "binary" && service.InstallPath != "" {
				service.WorkingDirectory = filepath.Dir(service.InstallPath)
			} else {
				service.WorkingDirectory = cfg.Runtime.RootDir
			}
		}
		if service.Restart == "" {
			service.Restart = "always"
		}
		if service.RestartSec <= 0 {
			service.RestartSec = 2
		}
		if service.WantedBy == "" {
			service.WantedBy = "multi-user.target"
		}
		if len(service.After) == 0 {
			service.After = []string{"network-online.target"}
		}
	} else {
		service.AllowControl = false
		service.Enabled = false
		service.Restart = ""
		service.RestartSec = 0
		service.ScriptPath = ""
		service.SystemdUnit = ""
	}

	if len(service.VersionCommand) == 0 && service.Kind == "binary" && service.InstallPath != "" {
		service.VersionCommand = []string{"{{install_path}}", "--version"}
	}
	if len(service.SetupCommand) == 0 && service.Kind == "wheel" && service.AllowUpdate {
		service.SetupCommand = []string{
			"python3",
			"-m",
			"pip",
			"install",
			"--no-deps",
			"--force-reinstall",
			"{{artifact_path}}",
		}
	}

	if service.AllowControl && len(service.ExecStart) == 0 {
		return ManagedServiceConfig{}, fmt.Errorf("allow_control requires exec_start")
	}
	if service.AllowUpdate {
		switch service.Kind {
		case "binary":
			if service.InstallPath == "" {
				return ManagedServiceConfig{}, fmt.Errorf("install_path is required for binary updates")
			}
		case "asset", "zip":
			if service.InstallPath == "" {
				return ManagedServiceConfig{}, fmt.Errorf("install_path is required for zip updates")
			}
		case "wheel":
			if len(service.SetupCommand) == 0 {
				return ManagedServiceConfig{}, fmt.Errorf("setup_command is required for wheel updates")
			}
		}
	}
	if len(service.ExecStart) > 0 && len(service.VersionCommand) == 0 {
		return ManagedServiceConfig{}, fmt.Errorf("version_command is required for systemd-managed %s services", service.Kind)
	}

	return service, nil
}

func cleanPathWithDefault(path string, fallback string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return filepath.Clean(fallback)
	}
	return filepath.Clean(trimmed)
}

func cleanOptionalPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	return filepath.Clean(trimmed)
}

func cleanPathList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		path := cleanOptionalPath(value)
		if path == "" {
			continue
		}
		cleaned = append(cleaned, path)
	}
	return cleaned
}

func cleanStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		cleaned = append(cleaned, trimmed)
	}
	return cleaned
}

func cleanEnvironmentMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cleaned := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		cleaned[trimmedKey] = strings.TrimSpace(value)
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}
