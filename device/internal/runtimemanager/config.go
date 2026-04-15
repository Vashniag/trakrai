package runtimemanager

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/trakrai/device-services/internal/shared/configjson"
)

const ServiceName = "runtime-manager"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type SystemdConfig struct {
	Bin           string `json:"bin"`
	Shell         string `json:"shell"`
	UnitDirectory string `json:"unit_directory"`
}

type HTTPConfig struct {
	DownloadTimeoutSec int    `json:"download_timeout_sec"`
	UserAgent          string `json:"user_agent"`
}

type RuntimePathsConfig struct {
	BinaryDir   string `json:"binary_dir"`
	DownloadDir string `json:"download_dir"`
	LogDir      string `json:"log_dir"`
	RootDir     string `json:"root_dir"`
	ScriptDir   string `json:"script_dir"`
	StateFile   string `json:"state_file"`
	VersionDir  string `json:"version_dir"`
}

type ManagedServiceConfig struct {
	After            []string          `json:"after,omitempty"`
	AllowControl     bool              `json:"allow_control"`
	AllowUpdate      bool              `json:"allow_update"`
	Core             bool              `json:"core"`
	Description      string            `json:"description,omitempty"`
	DisplayName      string            `json:"display_name,omitempty"`
	Enabled          bool              `json:"enabled"`
	Environment      map[string]string `json:"environment,omitempty"`
	EnvironmentFiles []string          `json:"environment_files,omitempty"`
	ExecStart        []string          `json:"exec_start,omitempty"`
	Group            string            `json:"group,omitempty"`
	InstallPath      string            `json:"install_path,omitempty"`
	Kind             string            `json:"kind,omitempty"`
	LogPath          string            `json:"log_path,omitempty"`
	Name             string            `json:"name"`
	Requires         []string          `json:"requires,omitempty"`
	Restart          string            `json:"restart,omitempty"`
	RestartSec       int               `json:"restart_sec,omitempty"`
	ScriptPath       string            `json:"script_path,omitempty"`
	SetupCommand     []string          `json:"setup_command,omitempty"`
	SystemdUnit      string            `json:"systemd_unit,omitempty"`
	User             string            `json:"user,omitempty"`
	VersionCommand   []string          `json:"version_command,omitempty"`
	VersionFile      string            `json:"version_file,omitempty"`
	WantedBy         string            `json:"wanted_by,omitempty"`
	WorkingDirectory string            `json:"working_directory,omitempty"`
}

type Config struct {
	HTTP     HTTPConfig             `json:"http"`
	IPC      IPCConfig              `json:"ipc"`
	LogLevel string                 `json:"log_level"`
	Runtime  RuntimePathsConfig     `json:"runtime"`
	Services []ManagedServiceConfig `json:"services"`
	Systemd  SystemdConfig          `json:"systemd"`
}

func LoadConfig(path string) (*Config, error) {
	cfg := &Config{
		LogLevel: "info",
		HTTP: HTTPConfig{
			DownloadTimeoutSec: 300,
			UserAgent:          "trakrai-runtime-manager/1.0",
		},
		IPC: IPCConfig{
			SocketPath: "/tmp/trakrai-cloud-comm.sock",
		},
		Runtime: RuntimePathsConfig{
			RootDir: filepath.Join(os.TempDir(), "trakrai-runtime"),
		},
		Systemd: SystemdConfig{
			Bin:           "systemctl",
			Shell:         "/bin/bash",
			UnitDirectory: "/etc/systemd/system",
		},
	}

	if err := configjson.Load(path, cfg); err != nil {
		return nil, err
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
	if cfg.HTTP.UserAgent == "" {
		cfg.HTTP.UserAgent = "trakrai-runtime-manager/1.0"
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
	if cfg.Runtime.DownloadDir == "" {
		cfg.Runtime.DownloadDir = filepath.Join(cfg.Runtime.RootDir, "downloads")
	}
	if cfg.Runtime.LogDir == "" {
		cfg.Runtime.LogDir = filepath.Join(cfg.Runtime.RootDir, "logs")
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
	cfg.Runtime.DownloadDir = filepath.Clean(cfg.Runtime.DownloadDir)
	cfg.Runtime.LogDir = filepath.Clean(cfg.Runtime.LogDir)
	cfg.Runtime.ScriptDir = filepath.Clean(cfg.Runtime.ScriptDir)
	cfg.Runtime.StateFile = filepath.Clean(cfg.Runtime.StateFile)
	cfg.Runtime.VersionDir = filepath.Clean(cfg.Runtime.VersionDir)
	cfg.Systemd.UnitDirectory = filepath.Clean(cfg.Systemd.UnitDirectory)

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
