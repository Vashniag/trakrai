package runtimemanager

type ManagedServiceSnapshot struct {
	ActiveState      string   `json:"activeState,omitempty"`
	AllowControl     bool     `json:"allowControl"`
	AllowUpdate      bool     `json:"allowUpdate"`
	Core             bool     `json:"core"`
	CPUPercent       *float64 `json:"cpuPercent,omitempty"`
	Description      string   `json:"description,omitempty"`
	DisplayName      string   `json:"displayName"`
	Enabled          bool     `json:"enabled"`
	InstallPath      string   `json:"installPath,omitempty"`
	Kind             string   `json:"kind"`
	LoadState        string   `json:"loadState,omitempty"`
	LogPath          string   `json:"logPath,omitempty"`
	MainPID          int      `json:"mainPid,omitempty"`
	MemoryBytes      *int64   `json:"memoryBytes,omitempty"`
	Message          string   `json:"message,omitempty"`
	Name             string   `json:"name"`
	ProcessElapsed   string   `json:"processElapsed,omitempty"`
	ScriptPath       string   `json:"scriptPath,omitempty"`
	State            string   `json:"state"`
	SubState         string   `json:"subState,omitempty"`
	SystemdUnit      string   `json:"systemdUnit,omitempty"`
	UnitFileState    string   `json:"unitFileState,omitempty"`
	Version          string   `json:"version,omitempty"`
	VersionFile      string   `json:"versionFile,omitempty"`
	VersionSource    string   `json:"versionSource,omitempty"`
	VersionUpdatedAt string   `json:"versionUpdatedAt,omitempty"`
	WorkingDirectory string   `json:"workingDirectory,omitempty"`
}

type ManagedServiceDefinition struct {
	After            []string          `json:"after,omitempty"`
	AllowControl     bool              `json:"allowControl"`
	AllowUpdate      bool              `json:"allowUpdate"`
	Core             bool              `json:"core"`
	Description      string            `json:"description,omitempty"`
	DisplayName      string            `json:"displayName,omitempty"`
	Enabled          bool              `json:"enabled"`
	Environment      map[string]string `json:"environment,omitempty"`
	EnvironmentFiles []string          `json:"environmentFiles,omitempty"`
	ExecStart        []string          `json:"execStart,omitempty"`
	Group            string            `json:"group,omitempty"`
	InstallPath      string            `json:"installPath,omitempty"`
	Kind             string            `json:"kind,omitempty"`
	LogPath          string            `json:"logPath,omitempty"`
	Name             string            `json:"name"`
	Requires         []string          `json:"requires,omitempty"`
	Restart          string            `json:"restart,omitempty"`
	RestartSec       int               `json:"restartSec,omitempty"`
	ScriptPath       string            `json:"scriptPath,omitempty"`
	SetupCommand     []string          `json:"setupCommand,omitempty"`
	SystemdUnit      string            `json:"systemdUnit,omitempty"`
	User             string            `json:"user,omitempty"`
	VersionCommand   []string          `json:"versionCommand,omitempty"`
	VersionFile      string            `json:"versionFile,omitempty"`
	WantedBy         string            `json:"wantedBy,omitempty"`
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
}

type RuntimeStatusPayload struct {
	BinaryDir    string                   `json:"binaryDir"`
	CoreCount    int                      `json:"coreCount"`
	DownloadDir  string                   `json:"downloadDir"`
	GeneratedAt  string                   `json:"generatedAt"`
	LastAction   string                   `json:"lastAction,omitempty"`
	LastError    string                   `json:"lastError,omitempty"`
	LogDir       string                   `json:"logDir"`
	ManagedCount int                      `json:"managedCount"`
	RequestID    string                   `json:"requestId,omitempty"`
	ScriptDir    string                   `json:"scriptDir"`
	SharedDir    string                   `json:"sharedDir"`
	Services     []ManagedServiceSnapshot `json:"services"`
	StateFile    string                   `json:"stateFile"`
	VersionDir   string                   `json:"versionDir"`
}

type RuntimeActionPayload struct {
	Action      string                    `json:"action"`
	Definition  *ManagedServiceDefinition `json:"definition,omitempty"`
	Message     string                    `json:"message,omitempty"`
	Removed     bool                      `json:"removed,omitempty"`
	RequestID   string                    `json:"requestId,omitempty"`
	Service     *ManagedServiceSnapshot   `json:"service,omitempty"`
	ServiceName string                    `json:"serviceName"`
}

type RuntimeDefinitionPayload struct {
	Definition  ManagedServiceDefinition `json:"definition"`
	RequestID   string                   `json:"requestId,omitempty"`
	ServiceName string                   `json:"serviceName"`
}

type RuntimeLogPayload struct {
	Lines       []string `json:"lines"`
	LogPath     string   `json:"logPath,omitempty"`
	RequestID   string   `json:"requestId,omitempty"`
	ServiceName string   `json:"serviceName"`
	Truncated   bool     `json:"truncated"`
}

type RuntimeErrorPayload struct {
	Action      string `json:"action,omitempty"`
	Error       string `json:"error"`
	RequestID   string `json:"requestId,omitempty"`
	ServiceName string `json:"serviceName,omitempty"`
}

type versionRecord struct {
	ArtifactSHA256 string `json:"artifactSha256,omitempty"`
	RemotePath     string `json:"remotePath,omitempty"`
	ServiceName    string `json:"serviceName"`
	Source         string `json:"source"`
	Summary        string `json:"summary"`
	UpdatedAt      string `json:"updatedAt"`
}

type serviceRequest struct {
	RequestID   string `json:"requestId,omitempty"`
	ServiceName string `json:"serviceName"`
}

type logRequest struct {
	RequestID   string `json:"requestId,omitempty"`
	ServiceName string `json:"serviceName"`
	Lines       int    `json:"lines"`
}

type updateServiceRequest struct {
	ArtifactSHA256 string `json:"artifactSha256,omitempty"`
	RemotePath     string `json:"remotePath,omitempty"`
	RequestID      string `json:"requestId,omitempty"`
	ServiceName    string `json:"serviceName"`
}

type upsertServiceRequest struct {
	Definition ManagedServiceDefinition `json:"definition"`
	RequestID  string                   `json:"requestId,omitempty"`
}

type removeServiceRequest struct {
	PurgeFiles  bool   `json:"purgeFiles,omitempty"`
	RequestID   string `json:"requestId,omitempty"`
	ServiceName string `json:"serviceName"`
}

type managedServiceStateFile struct {
	Services []ManagedServiceConfig `json:"services"`
}
