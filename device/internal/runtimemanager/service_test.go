package runtimemanager

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseSystemdShowOutput(t *testing.T) {
	t.Parallel()

	state := parseSystemdShowOutput(`
ActiveState=active
LoadState=loaded
MainPID=4242
SubState=running
UnitFileState=enabled
`)

	if state.ActiveState != "active" {
		t.Fatalf("expected active state, got %q", state.ActiveState)
	}
	if state.LoadState != "loaded" {
		t.Fatalf("expected load state loaded, got %q", state.LoadState)
	}
	if state.MainPID != 4242 {
		t.Fatalf("expected main pid 4242, got %d", state.MainPID)
	}
	if state.SubState != "running" {
		t.Fatalf("expected sub state running, got %q", state.SubState)
	}
	if state.UnitFileState != "enabled" {
		t.Fatalf("expected unit file state enabled, got %q", state.UnitFileState)
	}
}

func TestSubstituteCommandArgs(t *testing.T) {
	t.Parallel()

	serviceConfig := ManagedServiceConfig{
		InstallPath: "/opt/trakrai/live-feed",
		Name:        "live-feed",
	}

	args := substituteCommandArgs(
		[]string{"python3", "-m", "pip", "install", "{{artifact_path}}", "--target", "{{install_path}}"},
		serviceConfig,
		"/tmp/live-feed.whl",
	)

	expected := []string{
		"python3",
		"-m",
		"pip",
		"install",
		"/tmp/live-feed.whl",
		"--target",
		"/opt/trakrai/live-feed",
	}
	if !reflect.DeepEqual(args, expected) {
		t.Fatalf("expected args %#v, got %#v", expected, args)
	}
}

func TestReadTailLines(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	logPath := filepath.Join(tempDir, "runtime-manager.log")
	if err := os.WriteFile(logPath, []byte("one\ntwo\nthree\nfour\n"), 0o644); err != nil {
		t.Fatalf("write log file failed: %v", err)
	}

	lines, truncated, err := readTailLines(logPath, 2)
	if err != nil {
		t.Fatalf("read tail lines failed: %v", err)
	}

	expected := []string{"three", "four"}
	if !reflect.DeepEqual(lines, expected) {
		t.Fatalf("expected lines %#v, got %#v", expected, lines)
	}
	if !truncated {
		t.Fatalf("expected tail read to be truncated")
	}
}

func TestNormalizeManagedServiceDefaults(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		Runtime: RuntimePathsConfig{
			BinaryDir:   "/opt/trakrai/bin",
			DownloadDir: "/opt/trakrai/downloads",
			LogDir:      "/opt/trakrai/logs",
			RootDir:     "/opt/trakrai",
			ScriptDir:   "/opt/trakrai/scripts",
			StateFile:   "/opt/trakrai/managed-services.json",
			VersionDir:  "/opt/trakrai/versions",
		},
		Systemd: SystemdConfig{
			Bin:           "systemctl",
			Shell:         "/bin/bash",
			UnitDirectory: "/etc/systemd/system",
		},
	}

	service, err := normalizeManagedService(cfg, ManagedServiceConfig{
		AllowControl: true,
		AllowUpdate:  true,
		Enabled:      true,
		ExecStart:    []string{"{{install_path}}", "-config", "/opt/trakrai/live-feed.json"},
		Kind:         "binary",
		Name:         "live-feed",
	})
	if err != nil {
		t.Fatalf("normalize managed service failed: %v", err)
	}

	if service.InstallPath != filepath.Join("/opt/trakrai/bin", "live-feed") {
		t.Fatalf("expected default install path, got %q", service.InstallPath)
	}
	if service.LogPath != filepath.Join("/opt/trakrai/logs", "live-feed.log") {
		t.Fatalf("expected default log path, got %q", service.LogPath)
	}
	if service.ScriptPath != filepath.Join("/opt/trakrai/scripts", "start-live-feed.sh") {
		t.Fatalf("expected default script path, got %q", service.ScriptPath)
	}
	if service.SystemdUnit != "trakrai-live-feed.service" {
		t.Fatalf("expected default systemd unit, got %q", service.SystemdUnit)
	}
	expectedVersionCommand := []string{"{{install_path}}", "--version"}
	if !reflect.DeepEqual(service.VersionCommand, expectedVersionCommand) {
		t.Fatalf("expected version command %#v, got %#v", expectedVersionCommand, service.VersionCommand)
	}
}

func TestRenderWrapperScriptIncludesVersionCommandAndExec(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		Systemd: SystemdConfig{
			Shell: "/bin/bash",
		},
	}
	service := &Service{
		cfg: cfg,
	}

	script, err := service.renderWrapperScript(ManagedServiceConfig{
		ExecStart:      []string{"{{install_path}}", "-config", "/opt/trakrai/live-feed.json"},
		InstallPath:    "/opt/trakrai/bin/live-feed",
		LogPath:        "/opt/trakrai/logs/live-feed.log",
		Name:           "live-feed",
		ScriptPath:     "/opt/trakrai/scripts/start-live-feed.sh",
		VersionCommand: []string{"{{install_path}}", "--version"},
		VersionFile:    "/opt/trakrai/versions/live-feed.txt",
	})
	if err != nil {
		t.Fatalf("render wrapper script failed: %v", err)
	}

	if !strings.Contains(script, "exec >>'/opt/trakrai/logs/live-feed.log' 2>&1") {
		t.Fatalf("wrapper script missing log redirection: %s", script)
	}
	if !containsAll(script, "'/opt/trakrai/bin/live-feed' '--version'", "'/opt/trakrai/bin/live-feed' '-config' '/opt/trakrai/live-feed.json'") {
		t.Fatalf("wrapper script missing substituted commands: %s", script)
	}
}

func TestSaveAndLoadManagedServicesState(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	cfg := &Config{
		Runtime: RuntimePathsConfig{
			BinaryDir:   filepath.Join(tempDir, "bin"),
			DownloadDir: filepath.Join(tempDir, "downloads"),
			LogDir:      filepath.Join(tempDir, "logs"),
			RootDir:     tempDir,
			ScriptDir:   filepath.Join(tempDir, "scripts"),
			StateFile:   filepath.Join(tempDir, "managed-services.json"),
			VersionDir:  filepath.Join(tempDir, "versions"),
		},
		Systemd: SystemdConfig{
			Bin:           "systemctl",
			Shell:         "/bin/bash",
			UnitDirectory: filepath.Join(tempDir, "units"),
		},
	}

	service, err := NewService(cfg)
	if err != nil {
		t.Fatalf("new service failed: %v", err)
	}

	definition := ManagedServiceConfig{
		AllowControl: true,
		AllowUpdate:  true,
		Enabled:      true,
		ExecStart:    []string{"{{install_path}}"},
		Kind:         "binary",
		Name:         "cloud-comm",
	}
	normalized, err := normalizeManagedService(cfg, definition)
	if err != nil {
		t.Fatalf("normalize service failed: %v", err)
	}

	service.storeManagedService(normalized)
	if err := service.saveManagedServices(); err != nil {
		t.Fatalf("save managed services failed: %v", err)
	}

	loadedServices, seededFromConfig, err := loadManagedServicesFromState(cfg)
	if err != nil {
		t.Fatalf("load managed services failed: %v", err)
	}
	if seededFromConfig {
		t.Fatalf("expected services to load from state file")
	}
	if len(loadedServices) != 1 || loadedServices[0].Name != "cloud-comm" {
		t.Fatalf("unexpected loaded services %#v", loadedServices)
	}
}

func containsAll(input string, values ...string) bool {
	for _, value := range values {
		if !strings.Contains(input, value) {
			return false
		}
	}
	return true
}
