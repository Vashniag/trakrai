package runtimemanager

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/trakrai/device-services/internal/cloudtransfer"
	"github.com/trakrai/device-services/internal/ipc"
)

const (
	defaultLogTailLines          = 120
	runtimeManagerActionType     = "runtime-manager-service-action"
	runtimeManagerDefinitionType = "runtime-manager-service-definition"
	runtimeManagerErrorType      = "runtime-manager-error"
	runtimeManagerLogType        = "runtime-manager-log"
	runtimeManagerStatusType     = "runtime-manager-status"
	runtimeManagerUpdateType     = "runtime-manager-update"
	statusRefreshInterval        = 20 * time.Second
	statusSnapshotCacheTTL       = time.Second
	systemCommandTimeout         = 15 * time.Second
	versionCommandTimeout        = 5 * time.Second
)

type systemdState struct {
	ActiveState   string
	LoadState     string
	MainPID       int
	SubState      string
	UnitFileState string
}

type processMetrics struct {
	CPUPercent  *float64
	Elapsed     string
	MemoryBytes *int64
}

// cpuSample tracks a prior reading of a PID's cumulative CPU jiffies.
// We keep one entry per observed PID; when a service restarts it gets a new
// PID and the old entry is never touched again (bounded by the number of
// managed services, so no explicit eviction is required).
type cpuSample struct {
	cpuJiffies int64
	sampledAt  time.Time
}

type Service struct {
	cfg              *Config
	ipcClient        *ipc.Client
	log              *slog.Logger
	managed          map[string]ManagedServiceConfig
	seededFromConfig bool

	managedMu sync.RWMutex
	opMu      sync.Mutex

	stateMu    sync.RWMutex
	lastAction string
	lastError  string

	statusSnapshotMu      sync.Mutex
	statusSnapshot        RuntimeStatusPayload
	statusSnapshotAt      time.Time
	statusSnapshotValid   bool
	statusSnapshotBuildCh chan struct{}
	systemMetrics         systemMetricsCollector
	transferResponses     *ipc.ResponseRouter

	cpuSamplesMu sync.Mutex
	cpuSamples   map[int]cpuSample
	clkTicks     int64

	execCommand func(context.Context, string, ...string) ([]byte, error)
	now         func() time.Time
}

func NewService(cfg *Config) (*Service, error) {
	managedServices, seededFromConfig, err := loadManagedServicesFromState(cfg)
	if err != nil {
		return nil, err
	}

	managed := make(map[string]ManagedServiceConfig, len(managedServices))
	for _, service := range managedServices {
		managed[strings.ToLower(service.Name)] = service
	}

	return &Service{
		cfg:               cfg,
		ipcClient:         ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		log:               slog.With("component", ServiceName),
		managed:           managed,
		seededFromConfig:  seededFromConfig,
		systemMetrics:     newHostMetricsCollector(cfg, time.Now),
		transferResponses: ipc.NewResponseRouter(),
		cpuSamples:        make(map[int]cpuSample),
		clkTicks:          detectClkTicks(),
		execCommand: func(ctx context.Context, command string, args ...string) ([]byte, error) {
			cmd := exec.CommandContext(ctx, command, args...)
			return cmd.CombinedOutput()
		},
		now: time.Now,
	}, nil
}

// detectClkTicks resolves `sysconf(_SC_CLK_TCK)` by exec'ing getconf. On Linux
// this value has been 100 for years — we use that as a fallback when getconf
// is unavailable.
func detectClkTicks() int64 {
	out, err := exec.Command("getconf", "CLK_TCK").Output()
	if err == nil {
		if v, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64); err == nil && v > 0 {
			return v
		}
	}
	return 100
}

func (s *Service) Run(ctx context.Context) error {
	if err := s.ensureRuntimeLayout(); err != nil {
		return fmt.Errorf("prepare runtime layout: %w", err)
	}
	if s.seededFromConfig {
		if err := s.saveManagedServices(); err != nil {
			return fmt.Errorf("persist managed services: %w", err)
		}
	}
	if err := s.reconcileAllManagedServices(ctx); err != nil {
		s.recordAction("reconcile managed services", err)
		s.log.Warn("runtime-manager startup reconcile failed", "error", err)
	}

	s.ipcClient.Start()
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("initial runtime-manager status report failed", "error", err)
	}

	go s.handleNotifications(ctx)
	go s.statusLoop(ctx)

	s.log.Info("trakrai runtime-manager ready",
		"managed_services", len(s.listManagedServices()),
		"runtime_root", s.cfg.Runtime.RootDir,
		"binary_dir", s.cfg.Runtime.BinaryDir,
		"downloads", s.cfg.Runtime.DownloadDir,
		"unit_directory", s.cfg.Systemd.UnitDirectory,
	)

	<-ctx.Done()

	if err := s.reportStatus("stopped"); err != nil {
		s.log.Debug("final runtime-manager status report failed", "error", err)
	}

	return nil
}

func (s *Service) Close() {
	s.ipcClient.Close()
}

func (s *Service) handleNotifications(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-s.ipcClient.Notifications():
			if !ok {
				return
			}
			switch notification.Method {
			case "mqtt-message":
				var message ipc.MqttMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid runtime-manager MQTT notification", "error", err)
					continue
				}
				if message.Subtopic != "command" {
					continue
				}
				go s.handleCommand(ctx, message.Envelope)

			case "service-message":
				var message ipc.ServiceMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid runtime-manager service notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) != "response" {
					continue
				}
				s.transferResponses.Dispatch(message)
			}
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, env ipc.MQTTEnvelope) {
	switch env.Type {
	case "get-status":
		s.handleGetStatus(ctx, ipc.ReadRequestID(env.Payload))
	case "get-service-definition":
		s.handleGetServiceDefinition(env)
	case "get-service-log":
		s.handleLogRequest(ctx, env)
	case "remove-service":
		s.handleRemoveService(ctx, env)
	case "restart-service":
		s.handleServiceAction(ctx, env, "restart")
	case "start-service":
		s.handleServiceAction(ctx, env, "start")
	case "stop-service":
		s.handleServiceAction(ctx, env, "stop")
	case "update-service":
		s.handleUpdateService(ctx, env)
	case "upsert-service":
		s.handleUpsertService(ctx, env)
	default:
		s.publishError(RuntimeErrorPayload{
			Action: "command",
			Error:  fmt.Sprintf("unsupported runtime-manager command %q", env.Type),
		})
	}
}

func (s *Service) handleGetStatus(ctx context.Context, requestID string) {
	payload, err := s.buildStatusPayload(ctx)
	if err != nil {
		s.recordAction("refresh status", err)
		s.publishError(RuntimeErrorPayload{
			Action:    "get-status",
			Error:     err.Error(),
			RequestID: requestID,
		})
		return
	}

	payload.RequestID = requestID
	s.recordAction("refresh status", nil)
	if err := s.publishResponse(runtimeManagerStatusType, payload); err != nil {
		s.log.Warn("publish runtime-manager status failed", "error", err)
	}
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("runtime-manager status report failed", "error", err)
	}
}

func (s *Service) handleGetServiceDefinition(env ipc.MQTTEnvelope) {
	var request serviceRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: "get-service-definition",
			Error:  fmt.Sprintf("invalid service request: %v", err),
		})
		return
	}

	serviceConfig, err := s.lookupService(request.ServiceName)
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:      "get-service-definition",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: request.ServiceName,
		})
		return
	}

	s.recordAction(fmt.Sprintf("load definition for %s", serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerDefinitionType, RuntimeDefinitionPayload{
		Definition:  definitionFromConfig(serviceConfig),
		RequestID:   request.RequestID,
		ServiceName: serviceConfig.Name,
	}); err != nil {
		s.log.Warn("publish runtime-manager definition failed", "error", err)
	}
}

func (s *Service) handleLogRequest(ctx context.Context, env ipc.MQTTEnvelope) {
	var request logRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: "get-service-log",
			Error:  fmt.Sprintf("invalid log request: %v", err),
		})
		return
	}

	serviceConfig, err := s.lookupService(request.ServiceName)
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:      "get-service-log",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: request.ServiceName,
		})
		return
	}
	if serviceConfig.LogPath == "" {
		s.publishError(RuntimeErrorPayload{
			Action:      "get-service-log",
			Error:       "log_path is not configured for this service",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	if request.Lines <= 0 {
		request.Lines = defaultLogTailLines
	}

	lines, truncated, err := readTailLines(serviceConfig.LogPath, request.Lines)
	if err != nil {
		s.recordAction(fmt.Sprintf("read logs for %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "get-service-log",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	s.recordAction(fmt.Sprintf("read logs for %s", serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerLogType, RuntimeLogPayload{
		Lines:       lines,
		LogPath:     serviceConfig.LogPath,
		RequestID:   request.RequestID,
		ServiceName: serviceConfig.Name,
		Truncated:   truncated,
	}); err != nil {
		s.log.Warn("publish runtime-manager log response failed", "error", err)
	}
}

func (s *Service) handleServiceAction(ctx context.Context, env ipc.MQTTEnvelope, action string) {
	var request serviceRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: action,
			Error:  fmt.Sprintf("invalid service request: %v", err),
		})
		return
	}

	serviceConfig, err := s.lookupService(request.ServiceName)
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:      action,
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: request.ServiceName,
		})
		return
	}
	if !serviceConfig.AllowControl || serviceConfig.SystemdUnit == "" {
		s.publishError(RuntimeErrorPayload{
			Action:      action,
			Error:       "service control is disabled for this service",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	s.opMu.Lock()
	defer s.opMu.Unlock()

	commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
	defer cancel()

	output, err := s.runSystemctl(commandCtx, action, serviceConfig.SystemdUnit)
	if err != nil {
		s.recordAction(fmt.Sprintf("%s %s", action, serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      action,
			Error:       formatCommandError(err, output),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	snapshot, inspectErr := s.inspectManagedService(ctx, serviceConfig)
	if inspectErr != nil {
		s.log.Warn("inspect service after action failed", "service", serviceConfig.Name, "error", inspectErr)
	}

	s.invalidateStatusSnapshot()
	s.recordAction(fmt.Sprintf("%s %s", action, serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerActionType, RuntimeActionPayload{
		Action:      action,
		Message:     normalizeCommandOutput(output),
		RequestID:   request.RequestID,
		Service:     snapshot,
		ServiceName: serviceConfig.Name,
	}); err != nil {
		s.log.Warn("publish runtime-manager action response failed", "error", err)
	}
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("runtime-manager status report failed", "error", err)
	}
}

func (s *Service) handleUpdateService(ctx context.Context, env ipc.MQTTEnvelope) {
	var request updateServiceRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: "update-service",
			Error:  fmt.Sprintf("invalid update request: %v", err),
		})
		return
	}

	serviceConfig, err := s.lookupService(request.ServiceName)
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: request.ServiceName,
		})
		return
	}
	if !serviceConfig.AllowUpdate {
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       "updates are disabled for this service",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	if serviceConfig.Name == ServiceName {
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       "runtime-manager self-updates are disabled from the UI",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	if strings.TrimSpace(request.RemotePath) == "" {
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       "remotePath is required",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	artifactPath, artifactSHA, err := s.prepareUpdateArtifact(ctx, serviceConfig, request)
	if err != nil {
		s.recordAction(fmt.Sprintf("update %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	defer func() {
		_ = os.Remove(artifactPath)
	}()

	s.opMu.Lock()
	defer s.opMu.Unlock()

	snapshot, message, err := s.applyUpdate(ctx, serviceConfig, artifactPath, request.RemotePath, artifactSHA)
	if err != nil {
		s.recordAction(fmt.Sprintf("update %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "update-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	s.invalidateStatusSnapshot()
	s.recordAction(fmt.Sprintf("update %s", serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerUpdateType, RuntimeActionPayload{
		Action:      "update-service",
		Message:     message,
		RequestID:   request.RequestID,
		Service:     snapshot,
		ServiceName: serviceConfig.Name,
	}); err != nil {
		s.log.Warn("publish runtime-manager update response failed", "error", err)
	}
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("runtime-manager status report failed", "error", err)
	}
}

func (s *Service) handleUpsertService(ctx context.Context, env ipc.MQTTEnvelope) {
	var request upsertServiceRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: "upsert-service",
			Error:  fmt.Sprintf("invalid upsert request: %v", err),
		})
		return
	}

	serviceConfig, err := normalizeManagedService(s.cfg, configFromDefinition(request.Definition))
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:    "upsert-service",
			Error:     err.Error(),
			RequestID: request.RequestID,
		})
		return
	}

	s.opMu.Lock()
	defer s.opMu.Unlock()

	previous, existed := s.lookupServiceOptional(serviceConfig.Name)
	if existed && runtimeIdentityChanged(previous, serviceConfig) {
		if err := s.removeServiceSystemdArtifacts(ctx, previous); err != nil {
			s.recordAction(fmt.Sprintf("update definition for %s", serviceConfig.Name), err)
			s.publishError(RuntimeErrorPayload{
				Action:      "upsert-service",
				Error:       err.Error(),
				RequestID:   request.RequestID,
				ServiceName: serviceConfig.Name,
			})
			return
		}
	}

	s.storeManagedService(serviceConfig)
	if err := s.saveManagedServices(); err != nil {
		s.recordAction(fmt.Sprintf("save definition for %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "upsert-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	if err := s.reconcileServiceDefinition(ctx, serviceConfig); err != nil {
		s.recordAction(fmt.Sprintf("reconcile definition for %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "upsert-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	snapshot, inspectErr := s.inspectManagedService(ctx, serviceConfig)
	if inspectErr != nil {
		s.log.Warn("inspect service after definition update failed", "service", serviceConfig.Name, "error", inspectErr)
	}

	s.invalidateStatusSnapshot()
	s.recordAction(fmt.Sprintf("save definition for %s", serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerActionType, RuntimeActionPayload{
		Action:      "upsert-service",
		Definition:  definitionPointer(definitionFromConfig(serviceConfig)),
		Message:     fmt.Sprintf("saved definition for %s", serviceConfig.DisplayName),
		RequestID:   request.RequestID,
		Service:     snapshot,
		ServiceName: serviceConfig.Name,
	}); err != nil {
		s.log.Warn("publish runtime-manager upsert response failed", "error", err)
	}
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("runtime-manager status report failed", "error", err)
	}
}

func (s *Service) handleRemoveService(ctx context.Context, env ipc.MQTTEnvelope) {
	var request removeServiceRequest
	if err := unmarshalPayload(env.Payload, &request); err != nil {
		s.publishError(RuntimeErrorPayload{
			Action: "remove-service",
			Error:  fmt.Sprintf("invalid remove request: %v", err),
		})
		return
	}

	serviceConfig, err := s.lookupService(request.ServiceName)
	if err != nil {
		s.publishError(RuntimeErrorPayload{
			Action:      "remove-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: request.ServiceName,
		})
		return
	}
	if serviceConfig.Name == ServiceName {
		s.publishError(RuntimeErrorPayload{
			Action:      "remove-service",
			Error:       "runtime-manager cannot remove itself",
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	s.opMu.Lock()
	defer s.opMu.Unlock()

	if err := s.removeServiceSystemdArtifacts(ctx, serviceConfig); err != nil {
		s.recordAction(fmt.Sprintf("remove %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "remove-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}
	if request.PurgeFiles {
		if err := s.purgeManagedServiceFiles(serviceConfig); err != nil {
			s.recordAction(fmt.Sprintf("purge %s", serviceConfig.Name), err)
			s.publishError(RuntimeErrorPayload{
				Action:      "remove-service",
				Error:       err.Error(),
				RequestID:   request.RequestID,
				ServiceName: serviceConfig.Name,
			})
			return
		}
	}
	if err := s.removeVersionArtifacts(serviceConfig.Name, serviceConfig.VersionFile); err != nil {
		s.log.Warn("remove version artifacts failed", "service", serviceConfig.Name, "error", err)
	}

	s.deleteManagedService(serviceConfig.Name)
	if err := s.saveManagedServices(); err != nil {
		s.recordAction(fmt.Sprintf("remove %s", serviceConfig.Name), err)
		s.publishError(RuntimeErrorPayload{
			Action:      "remove-service",
			Error:       err.Error(),
			RequestID:   request.RequestID,
			ServiceName: serviceConfig.Name,
		})
		return
	}

	s.invalidateStatusSnapshot()
	s.recordAction(fmt.Sprintf("remove %s", serviceConfig.Name), nil)
	if err := s.publishResponse(runtimeManagerActionType, RuntimeActionPayload{
		Action:      "remove-service",
		Message:     fmt.Sprintf("removed service definition for %s", serviceConfig.DisplayName),
		Removed:     true,
		RequestID:   request.RequestID,
		ServiceName: serviceConfig.Name,
	}); err != nil {
		s.log.Warn("publish runtime-manager remove response failed", "error", err)
	}
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("runtime-manager status report failed", "error", err)
	}
}

func (s *Service) buildStatusPayload(ctx context.Context) (RuntimeStatusPayload, error) {
	for {
		s.statusSnapshotMu.Lock()
		if s.statusSnapshotValid && s.now().Sub(s.statusSnapshotAt) < statusSnapshotCacheTTL {
			payload := s.statusSnapshot
			s.statusSnapshotMu.Unlock()
			return payload, nil
		}

		if buildCh := s.statusSnapshotBuildCh; buildCh != nil {
			s.statusSnapshotMu.Unlock()

			select {
			case <-ctx.Done():
				return RuntimeStatusPayload{}, ctx.Err()
			case <-buildCh:
				continue
			}
		}

		buildCh := make(chan struct{})
		s.statusSnapshotBuildCh = buildCh
		s.statusSnapshotMu.Unlock()

		payload, err := s.buildFreshStatusPayload(ctx)

		s.statusSnapshotMu.Lock()
		if err == nil {
			s.statusSnapshot = payload
			s.statusSnapshotAt = s.now()
			s.statusSnapshotValid = true
		}
		close(buildCh)
		s.statusSnapshotBuildCh = nil
		s.statusSnapshotMu.Unlock()

		return payload, err
	}
}

func (s *Service) buildFreshStatusPayload(ctx context.Context) (RuntimeStatusPayload, error) {
	managedServices := s.listManagedServices()
	services := make([]ManagedServiceSnapshot, 0, len(managedServices))
	for _, serviceConfig := range managedServices {
		snapshot, err := s.inspectManagedService(ctx, serviceConfig)
		if err != nil {
			return RuntimeStatusPayload{}, err
		}
		services = append(services, *snapshot)
	}

	lastAction, lastError := s.currentActionState()
	coreCount := 0
	for _, service := range managedServices {
		if service.Core {
			coreCount++
		}
	}
	systemSnapshot := RuntimeSystemSnapshot{}
	if s.systemMetrics != nil {
		systemSnapshot = s.systemMetrics.Collect(ctx)
	}

	return RuntimeStatusPayload{
		BinaryDir:    s.cfg.Runtime.BinaryDir,
		CoreCount:    coreCount,
		DownloadDir:  s.cfg.Runtime.DownloadDir,
		GeneratedAt:  s.now().UTC().Format(time.RFC3339Nano),
		LastAction:   lastAction,
		LastError:    lastError,
		LogDir:       s.cfg.Runtime.LogDir,
		ManagedCount: len(services),
		ScriptDir:    s.cfg.Runtime.ScriptDir,
		SharedDir:    s.cfg.Runtime.SharedDir,
		Services:     services,
		StateFile:    s.cfg.Runtime.StateFile,
		System:       systemSnapshot,
		VersionDir:   s.cfg.Runtime.VersionDir,
	}, nil
}

func (s *Service) invalidateStatusSnapshot() {
	s.statusSnapshotMu.Lock()
	defer s.statusSnapshotMu.Unlock()

	s.statusSnapshot = RuntimeStatusPayload{}
	s.statusSnapshotAt = time.Time{}
	s.statusSnapshotValid = false
}

func (s *Service) inspectManagedService(ctx context.Context, serviceConfig ManagedServiceConfig) (*ManagedServiceSnapshot, error) {
	snapshot := &ManagedServiceSnapshot{
		AllowControl:     serviceConfig.AllowControl,
		AllowUpdate:      serviceConfig.AllowUpdate,
		Core:             serviceConfig.Core,
		Description:      serviceConfig.Description,
		DisplayName:      serviceConfig.DisplayName,
		Enabled:          serviceConfig.Enabled,
		InstallPath:      serviceConfig.InstallPath,
		Kind:             serviceConfig.Kind,
		LogPath:          serviceConfig.LogPath,
		Name:             serviceConfig.Name,
		ScriptPath:       serviceConfig.ScriptPath,
		State:            "unknown",
		SystemdUnit:      serviceConfig.SystemdUnit,
		VersionFile:      serviceConfig.VersionFile,
		WorkingDirectory: serviceConfig.WorkingDirectory,
	}

	if serviceConfig.SystemdUnit != "" {
		state, err := s.readSystemdState(ctx, serviceConfig.SystemdUnit)
		if err != nil {
			snapshot.Message = err.Error()
			snapshot.State = "unknown"
		} else {
			snapshot.ActiveState = state.ActiveState
			snapshot.LoadState = state.LoadState
			snapshot.MainPID = state.MainPID
			snapshot.SubState = state.SubState
			snapshot.UnitFileState = state.UnitFileState
			snapshot.State = deriveManagedState(serviceConfig, state, serviceConfig.InstallPath)

			if state.MainPID > 0 {
				metrics, metricsErr := s.readProcessMetrics(ctx, state.MainPID)
				if metricsErr == nil {
					snapshot.CPUPercent = metrics.CPUPercent
					snapshot.MemoryBytes = metrics.MemoryBytes
					snapshot.ProcessElapsed = metrics.Elapsed
				}
			}
		}
	} else {
		snapshot.State = deriveManagedState(serviceConfig, systemdState{}, serviceConfig.InstallPath)
	}

	record, err := s.resolveVersion(ctx, serviceConfig, "", "")
	if err == nil && record != nil {
		snapshot.Version = record.Summary
		snapshot.VersionSource = record.Source
		snapshot.VersionUpdatedAt = record.UpdatedAt
	}

	return snapshot, nil
}

func (s *Service) resolveVersion(
	ctx context.Context,
	serviceConfig ManagedServiceConfig,
	remotePath string,
	artifactSHA string,
) (*versionRecord, error) {
	if serviceConfig.VersionFile != "" {
		summary, err := readVersionSummaryFile(serviceConfig.VersionFile)
		if err == nil && summary != "" {
			record := &versionRecord{
				ArtifactSHA256: artifactSHA,
				RemotePath:     remotePath,
				ServiceName:    serviceConfig.Name,
				Source:         "version-file",
				Summary:        summary,
				UpdatedAt:      s.now().UTC().Format(time.RFC3339Nano),
			}
			_ = s.writeVersionRecord(record)
			return record, nil
		}
	}

	if len(serviceConfig.VersionCommand) > 0 {
		commandCtx, cancel := context.WithTimeout(ctx, versionCommandTimeout)
		defer cancel()

		args := substituteCommandArgs(serviceConfig.VersionCommand, serviceConfig, "")
		if len(args) > 0 {
			output, err := s.executeCommand(commandCtx, args[0], args[1:]...)
			if err == nil {
				summary := firstNonEmptyLine(output)
				if summary != "" {
					record := &versionRecord{
						ArtifactSHA256: artifactSHA,
						RemotePath:     remotePath,
						ServiceName:    serviceConfig.Name,
						Source:         "version-command",
						Summary:        summary,
						UpdatedAt:      s.now().UTC().Format(time.RFC3339Nano),
					}
					_ = s.writeVersionRecord(record)
					return record, nil
				}
			}
		}
	}

	if artifactSHA != "" {
		record := &versionRecord{
			ArtifactSHA256: artifactSHA,
			RemotePath:     remotePath,
			ServiceName:    serviceConfig.Name,
			Source:         "artifact-sha256",
			Summary:        shortHash(artifactSHA),
			UpdatedAt:      s.now().UTC().Format(time.RFC3339Nano),
		}
		_ = s.writeVersionRecord(record)
		return record, nil
	}

	record, err := s.readVersionRecord(serviceConfig.Name)
	if err == nil && record != nil {
		return record, nil
	}

	return nil, err
}

func (s *Service) applyUpdate(
	ctx context.Context,
	serviceConfig ManagedServiceConfig,
	artifactPath string,
	remotePath string,
	artifactSHA string,
) (*ManagedServiceSnapshot, string, error) {
	wasActive := false
	if serviceConfig.SystemdUnit != "" {
		state, err := s.readSystemdState(ctx, serviceConfig.SystemdUnit)
		if err == nil {
			wasActive = strings.EqualFold(state.ActiveState, "active")
		}
	}

	if wasActive {
		commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
		defer cancel()

		if output, err := s.runSystemctl(commandCtx, "stop", serviceConfig.SystemdUnit); err != nil {
			return nil, "", fmt.Errorf("stop service before update: %s", formatCommandError(err, output))
		}
	}

	switch serviceConfig.Kind {
	case "asset", "zip":
		if err := installZip(artifactPath, serviceConfig.InstallPath); err != nil {
			return nil, "", err
		}
	case "binary":
		if err := installBinary(artifactPath, serviceConfig.InstallPath); err != nil {
			return nil, "", err
		}
	case "wheel":
		if err := s.installWheel(ctx, serviceConfig, artifactPath); err != nil {
			return nil, "", err
		}
	default:
		return nil, "", fmt.Errorf("unsupported update kind %q", serviceConfig.Kind)
	}

	if len(serviceConfig.SetupCommand) > 0 && serviceConfig.Kind != "wheel" {
		if err := s.runSetupCommand(ctx, serviceConfig, artifactPath); err != nil {
			return nil, "", err
		}
	}

	if wasActive && serviceConfig.SystemdUnit != "" {
		commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
		defer cancel()

		if output, err := s.runSystemctl(commandCtx, "start", serviceConfig.SystemdUnit); err != nil {
			return nil, "", fmt.Errorf("start service after update: %s", formatCommandError(err, output))
		}
	}

	record, err := s.resolveVersion(ctx, serviceConfig, remotePath, artifactSHA)
	if err != nil {
		s.log.Debug("resolve version after update failed", "service", serviceConfig.Name, "error", err)
	}

	snapshot, inspectErr := s.inspectManagedService(ctx, serviceConfig)
	if inspectErr != nil {
		return nil, "", inspectErr
	}

	message := fmt.Sprintf("updated %s", serviceConfig.DisplayName)
	if record != nil && record.Summary != "" {
		message = fmt.Sprintf("%s to %s", message, record.Summary)
	}

	return snapshot, message, nil
}

func (s *Service) installWheel(ctx context.Context, serviceConfig ManagedServiceConfig, artifactPath string) error {
	if len(serviceConfig.SetupCommand) == 0 {
		return fmt.Errorf("setup_command is required for wheel updates")
	}
	return s.runSetupCommand(ctx, serviceConfig, artifactPath)
}

func installBinary(artifactPath string, installPath string) error {
	if installPath == "" {
		return fmt.Errorf("install_path is required")
	}
	if err := os.MkdirAll(filepath.Dir(installPath), 0o755); err != nil {
		return fmt.Errorf("create install directory: %w", err)
	}

	tempPath, err := os.CreateTemp(filepath.Dir(installPath), filepath.Base(installPath)+".new-*")
	if err != nil {
		return fmt.Errorf("create temporary binary: %w", err)
	}
	tempName := tempPath.Name()
	_ = tempPath.Close()

	if err := copyFile(artifactPath, tempName, 0o755); err != nil {
		_ = os.Remove(tempName)
		return err
	}

	if err := os.Rename(tempName, installPath); err != nil {
		_ = os.Remove(tempName)
		return fmt.Errorf("replace binary: %w", err)
	}

	return nil
}

func installZip(artifactPath string, installPath string) error {
	if installPath == "" {
		return fmt.Errorf("install_path is required")
	}

	parentDir := filepath.Dir(installPath)
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		return fmt.Errorf("create install parent directory: %w", err)
	}

	stagingDir, err := os.MkdirTemp(parentDir, filepath.Base(installPath)+".extract-*")
	if err != nil {
		return fmt.Errorf("create staging directory: %w", err)
	}
	defer func() {
		_ = os.RemoveAll(stagingDir)
	}()

	if err := unzipArchive(artifactPath, stagingDir); err != nil {
		return err
	}

	replacementPath := stagingDir
	entries, err := os.ReadDir(stagingDir)
	if err == nil && len(entries) == 1 && entries[0].IsDir() {
		replacementPath = filepath.Join(stagingDir, entries[0].Name())
	}

	if err := os.RemoveAll(installPath); err != nil {
		return fmt.Errorf("remove previous install path: %w", err)
	}
	if err := os.Rename(replacementPath, installPath); err != nil {
		return fmt.Errorf("activate extracted archive: %w", err)
	}

	return nil
}

func unzipArchive(archivePath string, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open zip archive: %w", err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		targetPath := filepath.Join(destination, filepath.FromSlash(file.Name))
		if !isPathWithinRoot(destination, targetPath) {
			return fmt.Errorf("zip entry %q escapes destination", file.Name)
		}
		if file.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("zip entry %q is a symlink and is not supported", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0o755); err != nil {
				return fmt.Errorf("create zip directory %q: %w", targetPath, err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return fmt.Errorf("create zip parent %q: %w", targetPath, err)
		}

		inputFile, err := file.Open()
		if err != nil {
			return fmt.Errorf("open zip entry %q: %w", file.Name, err)
		}

		outputFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, file.Mode())
		if err != nil {
			_ = inputFile.Close()
			return fmt.Errorf("create extracted file %q: %w", targetPath, err)
		}

		if _, err := io.Copy(outputFile, inputFile); err != nil {
			_ = outputFile.Close()
			_ = inputFile.Close()
			return fmt.Errorf("extract zip entry %q: %w", file.Name, err)
		}

		_ = outputFile.Close()
		_ = inputFile.Close()
	}

	return nil
}

func (s *Service) runSetupCommand(ctx context.Context, serviceConfig ManagedServiceConfig, artifactPath string) error {
	commandArgs := substituteCommandArgs(serviceConfig.SetupCommand, serviceConfig, artifactPath)
	if len(commandArgs) == 0 {
		return fmt.Errorf("setup_command is empty")
	}

	commandCtx, cancel := context.WithTimeout(ctx, time.Duration(s.cfg.HTTP.DownloadTimeoutSec)*time.Second)
	defer cancel()

	output, err := s.executeCommand(commandCtx, commandArgs[0], commandArgs[1:]...)
	if err != nil {
		return fmt.Errorf("setup command failed: %s", formatCommandError(err, output))
	}

	return nil
}

func (s *Service) prepareUpdateArtifact(
	ctx context.Context,
	serviceConfig ManagedServiceConfig,
	request updateServiceRequest,
) (string, string, error) {
	return s.downloadArtifactViaTransfer(ctx, serviceConfig, request)
}

func (s *Service) downloadArtifactViaTransfer(
	ctx context.Context,
	serviceConfig ManagedServiceConfig,
	request updateServiceRequest,
) (string, string, error) {
	updateCtx, cancel := context.WithTimeout(ctx, time.Duration(s.cfg.Updates.WaitTimeoutSec)*time.Second)
	defer cancel()

	remotePath := strings.TrimSpace(request.RemotePath)
	artifactName := filepath.Base(strings.ReplaceAll(remotePath, "\\", "/"))
	if artifactName == "." || artifactName == "" {
		return "", "", fmt.Errorf("remotePath %q is invalid", request.RemotePath)
	}
	localPath := filepath.Join(s.cfg.Runtime.SharedDir, "package-downloads", serviceConfig.Name, artifactName)
	timeoutWindow := fmt.Sprintf("%ds", s.cfg.Updates.WaitTimeoutSec)

	initial, err := s.requestTransfer(updateCtx, "enqueue-download", cloudtransfer.EnqueueDownloadRequest{
		LocalPath:  localPath,
		RemotePath: remotePath,
		RequestID:  fmt.Sprintf("runtime-update-%d", s.now().UnixNano()),
		Scope:      cloudtransfer.ScopePackage,
		Timeout:    timeoutWindow,
	})
	if err != nil {
		return "", "", err
	}

	transfer, err := decodeTransferReply(initial)
	if err != nil {
		return "", "", err
	}

	ticker := time.NewTicker(time.Duration(s.cfg.Updates.PollIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		switch transfer.State {
		case cloudtransfer.StateCompleted:
			if request.ArtifactSHA256 != "" {
				actualSHA, err := sha256File(localPath)
				if err != nil {
					return "", "", err
				}
				if !strings.EqualFold(strings.TrimSpace(request.ArtifactSHA256), actualSHA) {
					return "", "", fmt.Errorf(
						"artifact SHA-256 mismatch: expected %s, got %s",
						request.ArtifactSHA256,
						actualSHA,
					)
				}
				return localPath, actualSHA, nil
			}
			actualSHA, err := sha256File(localPath)
			if err != nil {
				return localPath, "", nil
			}
			return localPath, actualSHA, nil
		case cloudtransfer.StateFailed:
			message := strings.TrimSpace(transfer.LastError)
			if message == "" {
				message = "download manager marked the package transfer as failed"
			}
			return "", "", fmt.Errorf("%s", message)
		}

		select {
		case <-updateCtx.Done():
			return "", "", fmt.Errorf("timed out waiting for package download: %w", updateCtx.Err())
		case <-ticker.C:
		}

		nextReply, err := s.requestTransfer(updateCtx, "get-transfer", cloudtransfer.GetTransferRequest{
			RequestID:  fmt.Sprintf("runtime-update-poll-%d", s.now().UnixNano()),
			TransferID: transfer.ID,
		})
		if err != nil {
			return "", "", err
		}
		transfer, err = decodeTransferReply(nextReply)
		if err != nil {
			return "", "", err
		}
	}
}

func (s *Service) requestTransfer(ctx context.Context, requestType string, payload interface{}) (ipc.ServiceMessageNotification, error) {
	return s.transferResponses.Request(ctx, s.ipcClient, s.cfg.Updates.DownloadService, requestType, payload)
}

func decodeTransferReply(message ipc.ServiceMessageNotification) (cloudtransfer.Transfer, error) {
	return cloudtransfer.DecodeServiceMessage(message)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open file for SHA-256 %q: %w", path, err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("hash file %q: %w", path, err)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (s *Service) ensureRuntimeLayout() error {
	directories := []string{
		s.cfg.Runtime.RootDir,
		s.cfg.Runtime.BinaryDir,
		s.cfg.Runtime.DownloadDir,
		s.cfg.Runtime.LogDir,
		s.cfg.Runtime.ScriptDir,
		s.cfg.Runtime.SharedDir,
		s.cfg.Runtime.VersionDir,
		filepath.Dir(s.cfg.Runtime.StateFile),
		s.cfg.Systemd.UnitDirectory,
	}

	for _, directory := range directories {
		if directory == "" {
			continue
		}
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return fmt.Errorf("create directory %q: %w", directory, err)
		}
	}

	return nil
}

func loadManagedServicesFromState(cfg *Config) ([]ManagedServiceConfig, bool, error) {
	data, err := os.ReadFile(cfg.Runtime.StateFile)
	if err != nil {
		if os.IsNotExist(err) {
			return append([]ManagedServiceConfig(nil), cfg.Services...), true, nil
		}
		return nil, false, fmt.Errorf("read managed service state: %w", err)
	}

	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return []ManagedServiceConfig{}, false, nil
	}

	var wrapped managedServiceStateFile
	if err := json.Unmarshal(data, &wrapped); err == nil && wrapped.Services != nil {
		services, normalizeErr := normalizeManagedServices(cfg, wrapped.Services)
		if normalizeErr != nil {
			return nil, false, normalizeErr
		}
		return services, false, nil
	}

	var legacy []ManagedServiceConfig
	if err := json.Unmarshal(data, &legacy); err == nil {
		services, normalizeErr := normalizeManagedServices(cfg, legacy)
		if normalizeErr != nil {
			return nil, false, normalizeErr
		}
		return services, false, nil
	}

	return nil, false, fmt.Errorf("parse managed service state %q", cfg.Runtime.StateFile)
}

func (s *Service) listManagedServices() []ManagedServiceConfig {
	s.managedMu.RLock()
	defer s.managedMu.RUnlock()

	services := make([]ManagedServiceConfig, 0, len(s.managed))
	for _, service := range s.managed {
		services = append(services, service)
	}

	sort.Slice(services, func(i, j int) bool {
		return services[i].Name < services[j].Name
	})

	return services
}

func (s *Service) lookupService(name string) (ManagedServiceConfig, error) {
	service, ok := s.lookupServiceOptional(name)
	if !ok {
		return ManagedServiceConfig{}, fmt.Errorf("managed service %q is not configured", strings.TrimSpace(name))
	}
	return service, nil
}

func (s *Service) lookupServiceOptional(name string) (ManagedServiceConfig, bool) {
	s.managedMu.RLock()
	defer s.managedMu.RUnlock()

	service, ok := s.managed[strings.ToLower(strings.TrimSpace(name))]
	return service, ok
}

func (s *Service) storeManagedService(service ManagedServiceConfig) {
	s.managedMu.Lock()
	defer s.managedMu.Unlock()
	s.managed[strings.ToLower(service.Name)] = service
}

func (s *Service) deleteManagedService(name string) {
	s.managedMu.Lock()
	defer s.managedMu.Unlock()
	delete(s.managed, strings.ToLower(strings.TrimSpace(name)))
}

func (s *Service) saveManagedServices() error {
	state := managedServiceStateFile{
		Services: s.listManagedServices(),
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal managed services state: %w", err)
	}
	if err := writeAtomicFile(s.cfg.Runtime.StateFile, data, 0o644); err != nil {
		return fmt.Errorf("write managed service state: %w", err)
	}
	s.seededFromConfig = false
	return nil
}

func (s *Service) reconcileAllManagedServices(ctx context.Context) error {
	var errors []string
	for _, service := range s.listManagedServices() {
		if err := s.reconcileServiceDefinition(ctx, service); err != nil {
			errors = append(errors, err.Error())
		}
	}
	if len(errors) == 0 {
		return nil
	}
	return fmt.Errorf(strings.Join(errors, "; "))
}

func (s *Service) reconcileServiceDefinition(ctx context.Context, service ManagedServiceConfig) error {
	if len(service.ExecStart) == 0 {
		return nil
	}

	if service.LogPath != "" {
		if err := os.MkdirAll(filepath.Dir(service.LogPath), 0o755); err != nil {
			return fmt.Errorf("create log directory for %s: %w", service.Name, err)
		}
	}
	if service.VersionFile != "" {
		if err := os.MkdirAll(filepath.Dir(service.VersionFile), 0o755); err != nil {
			return fmt.Errorf("create version directory for %s: %w", service.Name, err)
		}
	}
	if service.ScriptPath != "" {
		if err := os.MkdirAll(filepath.Dir(service.ScriptPath), 0o755); err != nil {
			return fmt.Errorf("create script directory for %s: %w", service.Name, err)
		}
	}

	scriptContents, err := s.renderWrapperScript(service)
	if err != nil {
		return fmt.Errorf("render wrapper script for %s: %w", service.Name, err)
	}
	if err := writeAtomicFile(service.ScriptPath, []byte(scriptContents), 0o755); err != nil {
		return fmt.Errorf("write wrapper script for %s: %w", service.Name, err)
	}

	unitContents := s.renderSystemdUnit(service)
	if err := writeAtomicFile(s.systemdUnitPath(service.SystemdUnit), []byte(unitContents), 0o644); err != nil {
		return fmt.Errorf("write systemd unit for %s: %w", service.Name, err)
	}

	if err := s.daemonReload(ctx); err != nil {
		return fmt.Errorf("daemon-reload after updating %s: %w", service.Name, err)
	}
	if service.Enabled {
		if _, err := s.runSystemctlWithTimeout(ctx, "enable", service.SystemdUnit); err != nil {
			return fmt.Errorf("enable %s: %w", service.SystemdUnit, err)
		}
	} else {
		if _, err := s.runSystemctlWithTimeout(ctx, "disable", service.SystemdUnit); err != nil {
			s.log.Debug("disable systemd unit failed", "unit", service.SystemdUnit, "error", err)
		}
	}

	return nil
}

func runtimeIdentityChanged(previous ManagedServiceConfig, next ManagedServiceConfig) bool {
	return previous.SystemdUnit != next.SystemdUnit ||
		previous.ScriptPath != next.ScriptPath ||
		(len(previous.ExecStart) > 0 && len(next.ExecStart) == 0)
}

func (s *Service) removeServiceSystemdArtifacts(ctx context.Context, service ManagedServiceConfig) error {
	if service.SystemdUnit != "" {
		if _, err := s.runSystemctlWithTimeout(ctx, "stop", service.SystemdUnit); err != nil {
			s.log.Debug("stop systemd unit before removal failed", "unit", service.SystemdUnit, "error", err)
		}
		if _, err := s.runSystemctlWithTimeout(ctx, "disable", service.SystemdUnit); err != nil {
			s.log.Debug("disable systemd unit before removal failed", "unit", service.SystemdUnit, "error", err)
		}
		if err := removeFileIfExists(s.systemdUnitPath(service.SystemdUnit)); err != nil {
			return fmt.Errorf("remove systemd unit for %s: %w", service.Name, err)
		}
	}
	if service.ScriptPath != "" {
		if err := removeFileIfExists(service.ScriptPath); err != nil {
			return fmt.Errorf("remove wrapper script for %s: %w", service.Name, err)
		}
	}
	if service.SystemdUnit != "" {
		if err := s.daemonReload(ctx); err != nil {
			return fmt.Errorf("daemon-reload after removing %s: %w", service.Name, err)
		}
	}

	return nil
}

func (s *Service) purgeManagedServiceFiles(service ManagedServiceConfig) error {
	if service.InstallPath != "" {
		if err := os.RemoveAll(service.InstallPath); err != nil {
			return fmt.Errorf("remove install path %q: %w", service.InstallPath, err)
		}
	}
	if service.LogPath != "" {
		if err := removeFileIfExists(service.LogPath); err != nil {
			return fmt.Errorf("remove log path %q: %w", service.LogPath, err)
		}
	}
	return nil
}

func (s *Service) removeVersionArtifacts(serviceName string, versionFile string) error {
	if versionFile != "" {
		if err := removeFileIfExists(versionFile); err != nil {
			return err
		}
	}
	if err := removeFileIfExists(s.versionRecordPath(serviceName)); err != nil {
		return err
	}
	return nil
}

func (s *Service) renderWrapperScript(service ManagedServiceConfig) (string, error) {
	if service.ScriptPath == "" {
		return "", fmt.Errorf("script_path is required")
	}
	if len(service.ExecStart) == 0 {
		return "", fmt.Errorf("exec_start is required")
	}

	var builder strings.Builder
	builder.WriteString("#!")
	builder.WriteString(s.cfg.Systemd.Shell)
	builder.WriteString("\nset -euo pipefail\n\n")

	if service.LogPath != "" {
		builder.WriteString("mkdir -p ")
		builder.WriteString(shellQuote(filepath.Dir(service.LogPath)))
		builder.WriteString("\n")
		builder.WriteString("exec >>")
		builder.WriteString(shellQuote(service.LogPath))
		builder.WriteString(" 2>&1\n")
		builder.WriteString("exec < /dev/null\n\n")
	}

	if service.VersionFile != "" {
		builder.WriteString("mkdir -p ")
		builder.WriteString(shellQuote(filepath.Dir(service.VersionFile)))
		builder.WriteString("\n")
	}

	if len(service.VersionCommand) > 0 && service.VersionFile != "" {
		versionCommand := renderShellCommand(substituteCommandArgs(service.VersionCommand, service, ""))
		builder.WriteString("version_output=\"$({ ")
		builder.WriteString(versionCommand)
		builder.WriteString("; } 2>&1 || true)\"\n")
		builder.WriteString("version_output=\"$(printf '%s\\n' \"$version_output\" | awk 'NF {print; exit}')\"\n")
		builder.WriteString("printf '%s\\n' \"${version_output:-unknown}\" > ")
		builder.WriteString(shellQuote(service.VersionFile))
		builder.WriteString("\n\n")
	}

	builder.WriteString("exec ")
	builder.WriteString(renderShellCommand(substituteCommandArgs(service.ExecStart, service, "")))
	builder.WriteString("\n")

	return builder.String(), nil
}

func (s *Service) renderSystemdUnit(service ManagedServiceConfig) string {
	var builder strings.Builder
	builder.WriteString("[Unit]\n")
	builder.WriteString("Description=")
	if service.Description != "" {
		builder.WriteString(service.Description)
	} else {
		builder.WriteString(service.DisplayName)
	}
	builder.WriteString("\n")
	if len(service.After) > 0 {
		builder.WriteString("After=")
		builder.WriteString(strings.Join(service.After, " "))
		builder.WriteString("\n")
	}
	if len(service.Requires) > 0 {
		builder.WriteString("Requires=")
		builder.WriteString(strings.Join(service.Requires, " "))
		builder.WriteString("\n")
	}

	builder.WriteString("\n[Service]\n")
	builder.WriteString("Type=simple\n")
	if service.User != "" {
		builder.WriteString("User=")
		builder.WriteString(service.User)
		builder.WriteString("\n")
	}
	if service.Group != "" {
		builder.WriteString("Group=")
		builder.WriteString(service.Group)
		builder.WriteString("\n")
	}
	if service.WorkingDirectory != "" {
		builder.WriteString("WorkingDirectory=")
		builder.WriteString(service.WorkingDirectory)
		builder.WriteString("\n")
	}

	envKeys := make([]string, 0, len(service.Environment))
	for key := range service.Environment {
		envKeys = append(envKeys, key)
	}
	sort.Strings(envKeys)
	for _, key := range envKeys {
		builder.WriteString("Environment=")
		builder.WriteString(strconv.Quote(fmt.Sprintf("%s=%s", key, service.Environment[key])))
		builder.WriteString("\n")
	}
	for _, path := range service.EnvironmentFiles {
		builder.WriteString("EnvironmentFile=")
		builder.WriteString(path)
		builder.WriteString("\n")
	}

	builder.WriteString("ExecStart=")
	builder.WriteString(s.cfg.Systemd.Shell)
	builder.WriteString(" ")
	builder.WriteString(service.ScriptPath)
	builder.WriteString("\n")
	builder.WriteString("Restart=")
	builder.WriteString(service.Restart)
	builder.WriteString("\n")
	builder.WriteString("RestartSec=")
	builder.WriteString(strconv.Itoa(service.RestartSec))
	builder.WriteString("\n")

	builder.WriteString("\n[Install]\n")
	builder.WriteString("WantedBy=")
	builder.WriteString(service.WantedBy)
	builder.WriteString("\n")

	return builder.String()
}

func renderShellCommand(command []string) string {
	parts := make([]string, 0, len(command))
	for _, part := range command {
		parts = append(parts, shellQuote(part))
	}
	return strings.Join(parts, " ")
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func definitionFromConfig(service ManagedServiceConfig) ManagedServiceDefinition {
	return ManagedServiceDefinition{
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
	}
}

func configFromDefinition(definition ManagedServiceDefinition) ManagedServiceConfig {
	return ManagedServiceConfig{
		After:            append([]string(nil), definition.After...),
		AllowControl:     definition.AllowControl,
		AllowUpdate:      definition.AllowUpdate,
		Core:             definition.Core,
		Description:      definition.Description,
		DisplayName:      definition.DisplayName,
		Enabled:          definition.Enabled,
		Environment:      cloneStringMap(definition.Environment),
		EnvironmentFiles: append([]string(nil), definition.EnvironmentFiles...),
		ExecStart:        append([]string(nil), definition.ExecStart...),
		Group:            definition.Group,
		InstallPath:      definition.InstallPath,
		Kind:             definition.Kind,
		LogPath:          definition.LogPath,
		Name:             definition.Name,
		Requires:         append([]string(nil), definition.Requires...),
		Restart:          definition.Restart,
		RestartSec:       definition.RestartSec,
		ScriptPath:       definition.ScriptPath,
		SetupCommand:     append([]string(nil), definition.SetupCommand...),
		SystemdUnit:      definition.SystemdUnit,
		User:             definition.User,
		VersionCommand:   append([]string(nil), definition.VersionCommand...),
		VersionFile:      definition.VersionFile,
		WantedBy:         definition.WantedBy,
		WorkingDirectory: definition.WorkingDirectory,
	}
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func definitionPointer(definition ManagedServiceDefinition) *ManagedServiceDefinition {
	return &definition
}

func (s *Service) readSystemdState(ctx context.Context, unit string) (systemdState, error) {
	commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
	defer cancel()

	output, err := s.executeCommand(
		commandCtx,
		s.cfg.Systemd.Bin,
		"show",
		unit,
		"--no-pager",
		"--property=ActiveState,LoadState,MainPID,SubState,UnitFileState",
	)
	if err != nil {
		return systemdState{}, fmt.Errorf("systemctl show %s: %s", unit, formatCommandError(err, output))
	}

	return parseSystemdShowOutput(output), nil
}

// readProcessMetrics returns a live sample of CPU%, resident memory, and
// wall-clock elapsed time for the given PID.
//
// CPU% is computed as the delta of (utime+stime) against the prior observation
// for that PID, divided by the wall-clock time between samples. That is an
// instantaneous "% of one core" figure (so a saturated single thread reports
// ~100, a saturated 4-thread process on 4 cores reports ~400). On the very
// first observation of a PID the sample is seeded and CPUPercent is left nil;
// the next status refresh will produce a real number.
//
// This replaces an older `ps -o %cpu=` path which returned `ps(1)`'s lifetime
// average (total CPU time divided by wall time since the process started),
// so a process that was busy earlier but is now idle kept reporting its
// historical average long after real usage had fallen to zero.
func (s *Service) readProcessMetrics(ctx context.Context, pid int) (processMetrics, error) {
	if pid <= 0 {
		return processMetrics{}, fmt.Errorf("invalid pid %d", pid)
	}
	statBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return processMetrics{}, fmt.Errorf("read /proc/%d/stat: %w", pid, err)
	}
	utime, stime, startTicks, err := parseProcStat(statBytes)
	if err != nil {
		return processMetrics{}, err
	}

	totalJiffies := utime + stime
	now := s.now()
	metrics := processMetrics{}

	s.cpuSamplesMu.Lock()
	prior, seen := s.cpuSamples[pid]
	s.cpuSamples[pid] = cpuSample{cpuJiffies: totalJiffies, sampledAt: now}
	s.cpuSamplesMu.Unlock()

	if seen && s.clkTicks > 0 {
		elapsed := now.Sub(prior.sampledAt).Seconds()
		deltaJiffies := totalJiffies - prior.cpuJiffies
		if elapsed > 0 && deltaJiffies >= 0 {
			cpuSeconds := float64(deltaJiffies) / float64(s.clkTicks)
			pct := (cpuSeconds / elapsed) * 100.0
			if pct < 0 {
				pct = 0
			}
			metrics.CPUPercent = &pct
		}
	}

	if rssKB, err := readVmRSSKB(pid); err == nil {
		memoryBytes := rssKB * 1024
		metrics.MemoryBytes = &memoryBytes
	}

	if s.clkTicks > 0 {
		if uptimeSec, err := readSystemUptime(); err == nil {
			procSec := uptimeSec - float64(startTicks)/float64(s.clkTicks)
			if procSec < 0 {
				procSec = 0
			}
			metrics.Elapsed = formatElapsed(procSec)
		}
	}

	return metrics, nil
}

// parseProcStat extracts utime, stime, and starttime from a /proc/<pid>/stat
// buffer. The 2nd field (`comm`) is wrapped in parentheses and may contain
// whitespace or close-parens of its own, so we locate the last ')' before
// tokenizing.
func parseProcStat(data []byte) (utime, stime, startTicks int64, err error) {
	raw := string(data)
	end := strings.LastIndex(raw, ")")
	if end < 0 {
		return 0, 0, 0, fmt.Errorf("malformed /proc/<pid>/stat: no closing paren")
	}
	fields := strings.Fields(raw[end+1:])
	// After the closing paren of `comm`, the first field is `state` (index 3 in
	// the upstream man page). utime=14, stime=15, starttime=22 ⇒ indices 11,
	// 12, 19 in this slice.
	if len(fields) < 20 {
		return 0, 0, 0, fmt.Errorf("malformed /proc/<pid>/stat: only %d fields after comm", len(fields))
	}
	if utime, err = strconv.ParseInt(fields[11], 10, 64); err != nil {
		return 0, 0, 0, fmt.Errorf("parse utime: %w", err)
	}
	if stime, err = strconv.ParseInt(fields[12], 10, 64); err != nil {
		return 0, 0, 0, fmt.Errorf("parse stime: %w", err)
	}
	if startTicks, err = strconv.ParseInt(fields[19], 10, 64); err != nil {
		return 0, 0, 0, fmt.Errorf("parse starttime: %w", err)
	}
	return utime, stime, startTicks, nil
}

func readVmRSSKB(pid int) (int64, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			return 0, fmt.Errorf("malformed VmRSS line: %q", line)
		}
		return strconv.ParseInt(parts[1], 10, 64)
	}
	return 0, fmt.Errorf("VmRSS not found in /proc/%d/status", pid)
}

func readSystemUptime() (float64, error) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	parts := strings.Fields(string(data))
	if len(parts) < 1 {
		return 0, fmt.Errorf("malformed /proc/uptime")
	}
	return strconv.ParseFloat(parts[0], 64)
}

// formatElapsed formats a duration in seconds using the same layout as `ps
// -o etime`: MM:SS, HH:MM:SS, or D-HH:MM:SS depending on magnitude.
func formatElapsed(seconds float64) string {
	total := int64(seconds)
	if total < 0 {
		total = 0
	}
	days := total / 86400
	hours := (total % 86400) / 3600
	minutes := (total % 3600) / 60
	secs := total % 60
	switch {
	case days > 0:
		return fmt.Sprintf("%d-%02d:%02d:%02d", days, hours, minutes, secs)
	case hours > 0:
		return fmt.Sprintf("%02d:%02d:%02d", hours, minutes, secs)
	default:
		return fmt.Sprintf("%02d:%02d", minutes, secs)
	}
}

func (s *Service) runSystemctl(ctx context.Context, action string, unit string) (string, error) {
	output, err := s.executeCommand(ctx, s.cfg.Systemd.Bin, action, unit)
	return output, err
}

func (s *Service) runSystemctlWithTimeout(ctx context.Context, action string, unit string) (string, error) {
	commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
	defer cancel()
	output, err := s.runSystemctl(commandCtx, action, unit)
	if err != nil {
		return output, fmt.Errorf(formatCommandError(err, output))
	}
	return output, nil
}

func (s *Service) daemonReload(ctx context.Context) error {
	commandCtx, cancel := context.WithTimeout(ctx, systemCommandTimeout)
	defer cancel()

	output, err := s.executeCommand(commandCtx, s.cfg.Systemd.Bin, "daemon-reload")
	if err != nil {
		return fmt.Errorf(formatCommandError(err, output))
	}
	return nil
}

func (s *Service) executeCommand(ctx context.Context, command string, args ...string) (string, error) {
	output, err := s.execCommand(ctx, command, args...)
	return strings.TrimSpace(string(output)), err
}

func (s *Service) publishResponse(messageType string, payload interface{}) error {
	return s.ipcClient.Publish("response", messageType, payload)
}

func (s *Service) publishError(payload RuntimeErrorPayload) {
	if err := s.publishResponse(runtimeManagerErrorType, payload); err != nil {
		s.log.Warn("publish runtime-manager error failed", "error", err)
	}
	if reportErr := s.ipcClient.ReportError(payload.Error, false); reportErr != nil {
		s.log.Debug("report runtime-manager error failed", "error", reportErr)
	}
}

func (s *Service) reportStatus(status string) error {
	details := map[string]interface{}{
		"available":       true,
		"binaryDir":       s.cfg.Runtime.BinaryDir,
		"downloadsDir":    s.cfg.Runtime.DownloadDir,
		"lastAction":      "",
		"lastError":       "",
		"managedServices": len(s.listManagedServices()),
		"runtimeRoot":     s.cfg.Runtime.RootDir,
		"sharedDir":       s.cfg.Runtime.SharedDir,
		"stateFile":       s.cfg.Runtime.StateFile,
		"versionDir":      s.cfg.Runtime.VersionDir,
	}
	lastAction, lastError := s.currentActionState()
	details["lastAction"] = lastAction
	details["lastError"] = lastError

	return s.ipcClient.ReportStatus(status, details)
}

func (s *Service) statusLoop(ctx context.Context) {
	ticker := time.NewTicker(statusRefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.reportStatus("running"); err != nil {
				s.log.Debug("periodic runtime-manager status report failed", "error", err)
			}
		}
	}
}

func (s *Service) recordAction(action string, err error) {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()

	s.lastAction = strings.TrimSpace(action)
	if err != nil {
		s.lastError = err.Error()
		return
	}
	s.lastError = ""
}

func (s *Service) currentActionState() (string, string) {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	return s.lastAction, s.lastError
}

func (s *Service) versionRecordPath(serviceName string) string {
	return filepath.Join(s.cfg.Runtime.VersionDir, serviceName+".json")
}

func (s *Service) readVersionRecord(serviceName string) (*versionRecord, error) {
	data, err := os.ReadFile(s.versionRecordPath(serviceName))
	if err != nil {
		return nil, err
	}

	var record versionRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func (s *Service) writeVersionRecord(record *versionRecord) error {
	if record == nil {
		return nil
	}

	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomicFile(s.versionRecordPath(record.ServiceName), data, 0o644)
}

func (s *Service) systemdUnitPath(unit string) string {
	return filepath.Join(s.cfg.Systemd.UnitDirectory, unit)
}

func deriveManagedState(serviceConfig ManagedServiceConfig, state systemdState, installPath string) string {
	if serviceConfig.SystemdUnit != "" {
		switch {
		case strings.EqualFold(state.ActiveState, "active"):
			return "running"
		case strings.EqualFold(state.ActiveState, "activating"):
			return "starting"
		case strings.EqualFold(state.ActiveState, "failed"):
			return "error"
		case strings.EqualFold(state.ActiveState, "inactive"), strings.EqualFold(state.SubState, "dead"):
			return "stopped"
		case strings.TrimSpace(state.ActiveState) != "":
			return strings.ToLower(state.ActiveState)
		default:
			return "unknown"
		}
	}

	if installPath == "" {
		return "available"
	}
	if _, err := os.Stat(installPath); err == nil {
		return "available"
	}
	return "missing"
}

func parseSystemdShowOutput(output string) systemdState {
	state := systemdState{}
	for _, line := range strings.Split(output, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}

		switch key {
		case "ActiveState":
			state.ActiveState = value
		case "LoadState":
			state.LoadState = value
		case "MainPID":
			mainPID, err := strconv.Atoi(strings.TrimSpace(value))
			if err == nil {
				state.MainPID = mainPID
			}
		case "SubState":
			state.SubState = value
		case "UnitFileState":
			state.UnitFileState = value
		}
	}
	return state
}

func substituteCommandArgs(command []string, serviceConfig ManagedServiceConfig, artifactPath string) []string {
	if len(command) == 0 {
		return nil
	}

	replacements := map[string]string{
		"{{artifact_path}}": artifactPath,
		"{{install_path}}":  serviceConfig.InstallPath,
		"{{service_name}}":  serviceConfig.Name,
	}

	resolved := make([]string, 0, len(command))
	for _, argument := range command {
		value := argument
		for token, replacement := range replacements {
			value = strings.ReplaceAll(value, token, replacement)
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		resolved = append(resolved, value)
	}

	return resolved
}

func readVersionSummaryFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return "", nil
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err == nil {
		for _, key := range []string{"summary", "version"} {
			if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value), nil
			}
		}
	}

	return firstNonEmptyLine(trimmed), nil
}

func firstNonEmptyLine(output string) string {
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeCommandOutput(output string) string {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "ok"
	}
	return firstNonEmptyLine(trimmed)
}

func formatCommandError(err error, output string) string {
	trimmedOutput := strings.TrimSpace(output)
	if trimmedOutput == "" {
		return err.Error()
	}
	return fmt.Sprintf("%s: %s", err.Error(), firstNonEmptyLine(trimmedOutput))
}

func copyFile(sourcePath string, destinationPath string, fileMode os.FileMode) error {
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open source file %q: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	destinationFile, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fileMode)
	if err != nil {
		return fmt.Errorf("open destination file %q: %w", destinationPath, err)
	}
	defer destinationFile.Close()

	if _, err := io.Copy(destinationFile, sourceFile); err != nil {
		return fmt.Errorf("copy %q to %q: %w", sourcePath, destinationPath, err)
	}

	if err := destinationFile.Chmod(fileMode); err != nil {
		return fmt.Errorf("chmod destination file %q: %w", destinationPath, err)
	}

	return nil
}

func hashFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open file %q: %w", path, err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("hash file %q: %w", path, err)
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func shortHash(hash string) string {
	trimmed := strings.TrimSpace(hash)
	if len(trimmed) <= 12 {
		return trimmed
	}
	return trimmed[:12]
}

func isPathWithinRoot(root string, candidate string) bool {
	relPath, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}

	return relPath != ".." && !strings.HasPrefix(relPath, ".."+string(filepath.Separator))
}

func unmarshalPayload(payload json.RawMessage, target interface{}) error {
	if len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, target)
}

func writeAtomicFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	tempFile, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = os.Remove(tempPath)
	}()

	if _, err := tempFile.Write(data); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Chmod(mode); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}

	return os.Rename(tempPath, path)
}

func removeFileIfExists(path string) error {
	if path == "" {
		return nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
