package runtimemanager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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
			StateFile:   "/opt/trakrai/state/managed-services.json",
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
		ExecStart:    []string{"{{install_path}}", "-config", "/opt/trakrai/configs/live-feed.json"},
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
		ExecStart:      []string{"{{install_path}}", "-config", "/opt/trakrai/configs/live-feed.json"},
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
	if !containsAll(script, "'/opt/trakrai/bin/live-feed' '--version'", "'/opt/trakrai/bin/live-feed' '-config' '/opt/trakrai/configs/live-feed.json'") {
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
			StateFile:   filepath.Join(tempDir, "state", "managed-services.json"),
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

func TestBuildStatusPayloadCachesFreshSnapshot(t *testing.T) {
	t.Parallel()

	currentTime := time.Date(2026, time.April, 15, 18, 0, 0, 0, time.UTC)
	service, commandCount := newStatusPayloadTestService(t, func() time.Time {
		return currentTime
	})

	firstPayload, err := service.buildStatusPayload(context.Background())
	if err != nil {
		t.Fatalf("build status payload failed: %v", err)
	}

	secondPayload, err := service.buildStatusPayload(context.Background())
	if err != nil {
		t.Fatalf("build cached status payload failed: %v", err)
	}

	if commandCount.Load() != 2 {
		t.Fatalf("expected cached status payload to reuse 2 command calls, got %d", commandCount.Load())
	}
	if firstPayload.GeneratedAt != secondPayload.GeneratedAt {
		t.Fatalf("expected cached payload generatedAt to match, got %q and %q", firstPayload.GeneratedAt, secondPayload.GeneratedAt)
	}

	currentTime = currentTime.Add(statusSnapshotCacheTTL + time.Millisecond)
	thirdPayload, err := service.buildStatusPayload(context.Background())
	if err != nil {
		t.Fatalf("build refreshed status payload failed: %v", err)
	}

	if commandCount.Load() != 4 {
		t.Fatalf("expected expired cache to rebuild status payload, got %d command calls", commandCount.Load())
	}
	if thirdPayload.GeneratedAt == secondPayload.GeneratedAt {
		t.Fatalf("expected refreshed payload to have a new generatedAt value, got %q", thirdPayload.GeneratedAt)
	}
}

func TestBuildStatusPayloadCoalescesConcurrentRequests(t *testing.T) {
	t.Parallel()

	service, commandCount := newStatusPayloadTestService(t, time.Now)
	start := make(chan struct{})
	var wg sync.WaitGroup
	errCh := make(chan error, 8)

	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := service.buildStatusPayload(context.Background())
			errCh <- err
		}()
	}

	close(start)
	wg.Wait()
	close(errCh)

	for err := range errCh {
		if err != nil {
			t.Fatalf("expected concurrent status payload build to succeed, got %v", err)
		}
	}

	if commandCount.Load() != 2 {
		t.Fatalf("expected concurrent requests to share 2 command calls, got %d", commandCount.Load())
	}
}

func newStatusPayloadTestService(
	t *testing.T,
	now func() time.Time,
) (*Service, *atomic.Int32) {
	t.Helper()

	commandCount := &atomic.Int32{}
	service := &Service{
		cfg: &Config{
			Runtime: RuntimePathsConfig{
				BinaryDir:   "/opt/trakrai/bin",
				DownloadDir: "/opt/trakrai/downloads",
				LogDir:      "/opt/trakrai/logs",
				RootDir:     "/opt/trakrai",
				ScriptDir:   "/opt/trakrai/scripts",
				StateFile:   "/opt/trakrai/state/managed-services.json",
				VersionDir:  "/opt/trakrai/versions",
			},
			Systemd: SystemdConfig{
				Bin:           "systemctl",
				Shell:         "/bin/bash",
				UnitDirectory: "/etc/systemd/system",
			},
		},
		managed: map[string]ManagedServiceConfig{
			"cloud-comm": {
				DisplayName: "Cloud comm",
				Enabled:     true,
				InstallPath: "/opt/trakrai/bin/cloud-comm",
				Kind:        "binary",
				Name:        "cloud-comm",
				SystemdUnit: "trakrai-cloud-comm.service",
			},
		},
		execCommand: func(_ context.Context, command string, args ...string) ([]byte, error) {
			commandCount.Add(1)
			time.Sleep(20 * time.Millisecond)

			switch {
			case command == "systemctl" && len(args) >= 2 && args[0] == "show":
				return []byte(strings.Join([]string{
					"ActiveState=active",
					"LoadState=loaded",
					"MainPID=42",
					"SubState=running",
					"UnitFileState=enabled",
				}, "\n")), nil
			case command == "ps" && len(args) >= 1:
				return []byte("12.5 1024 00:10"), nil
			default:
				return nil, fmt.Errorf("unexpected command: %s %v", command, args)
			}
		},
		now: now,
	}

	return service, commandCount
}

func containsAll(input string, values ...string) bool {
	for _, value := range values {
		if !strings.Contains(input, value) {
			return false
		}
	}
	return true
}
