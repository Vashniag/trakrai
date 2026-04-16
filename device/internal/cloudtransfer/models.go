package cloudtransfer

import (
	"encoding/json"
	"time"
)

type Direction string

const (
	DirectionDownload Direction = "download"
	DirectionUpload   Direction = "upload"
)

type StorageScope string

const (
	ScopeDevice  StorageScope = "device"
	ScopePackage StorageScope = "package"
)

type TransferState string

const (
	StateCompleted TransferState = "completed"
	StateFailed    TransferState = "failed"
	StateQueued    TransferState = "queued"
	StateRetryWait TransferState = "retry_wait"
	StateRunning   TransferState = "running"
)

type EnqueueUploadRequest struct {
	ContentType string            `json:"contentType,omitempty"`
	LocalPath   string            `json:"localPath"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	RequestID   string            `json:"requestId,omitempty"`
	RemotePath  string            `json:"remotePath"`
	Scope       StorageScope      `json:"scope,omitempty"`
	Timeout     string            `json:"timeout,omitempty"`
}

type EnqueueDownloadRequest struct {
	LocalPath  string            `json:"localPath"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	RequestID  string            `json:"requestId,omitempty"`
	RemotePath string            `json:"remotePath"`
	Scope      StorageScope      `json:"scope,omitempty"`
	Timeout    string            `json:"timeout,omitempty"`
}

type GetTransferRequest struct {
	RequestID  string `json:"requestId,omitempty"`
	TransferID string `json:"transferId"`
}

type ListTransfersRequest struct {
	Direction Direction     `json:"direction,omitempty"`
	Limit     int           `json:"limit,omitempty"`
	RequestID string        `json:"requestId,omitempty"`
	State     TransferState `json:"state,omitempty"`
}

type StatsRequest struct {
	RequestID string `json:"requestId,omitempty"`
}

type TransferPayload struct {
	RequestID string   `json:"requestId,omitempty"`
	Transfer  Transfer `json:"transfer"`
}

type TransferListPayload struct {
	Items     []Transfer `json:"items"`
	RequestID string     `json:"requestId,omitempty"`
}

type TransferStatsPayload struct {
	RequestID string     `json:"requestId,omitempty"`
	Stats     QueueStats `json:"stats"`
}

type TransferStatusPayload struct {
	DatabasePath string     `json:"databasePath"`
	DeviceID     string     `json:"deviceId"`
	RequestID    string     `json:"requestId,omitempty"`
	SharedDir    string     `json:"sharedDir"`
	Stats        QueueStats `json:"stats"`
}

type TransferErrorPayload struct {
	Error       string `json:"error"`
	RequestID   string `json:"requestId,omitempty"`
	RequestType string `json:"requestType,omitempty"`
}

type QueueStats struct {
	Completed          int        `json:"completed"`
	DownloadQueued     int        `json:"downloadQueued"`
	DownloadsCompleted int        `json:"downloadsCompleted"`
	DownloadsFailed    int        `json:"downloadsFailed"`
	Failed             int        `json:"failed"`
	NextAttemptAt      *time.Time `json:"nextAttemptAt,omitempty"`
	Pending            int        `json:"pending"`
	Running            int        `json:"running"`
	Total              int        `json:"total"`
	UploadQueued       int        `json:"uploadQueued"`
	UploadsCompleted   int        `json:"uploadsCompleted"`
	UploadsFailed      int        `json:"uploadsFailed"`
}

type Transfer struct {
	Attempts      int               `json:"attempts"`
	CompletedAt   *time.Time        `json:"completedAt,omitempty"`
	ContentType   string            `json:"contentType,omitempty"`
	CreatedAt     time.Time         `json:"createdAt"`
	DeadlineAt    *time.Time        `json:"deadlineAt,omitempty"`
	DeviceID      string            `json:"deviceId"`
	Direction     Direction         `json:"direction"`
	ID            string            `json:"id"`
	LastError     string            `json:"lastError,omitempty"`
	LocalPath     string            `json:"localPath"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	NextAttemptAt *time.Time        `json:"nextAttemptAt,omitempty"`
	ObjectKey     string            `json:"objectKey,omitempty"`
	RemotePath    string            `json:"remotePath"`
	Scope         StorageScope      `json:"scope,omitempty"`
	StartedAt     *time.Time        `json:"startedAt,omitempty"`
	State         TransferState     `json:"state"`
	UpdatedAt     time.Time         `json:"updatedAt"`
}

type storedTransfer struct {
	Attempts      int
	CompletedAt   *time.Time
	ContentType   string
	CreatedAt     time.Time
	DeadlineAt    *time.Time
	DeviceID      string
	Direction     Direction
	ID            string
	LastError     string
	LocalPath     string
	MetadataJSON  string
	NextAttemptAt *time.Time
	ObjectKey     string
	RemotePath    string
	Scope         StorageScope
	StartedAt     *time.Time
	State         TransferState
	UpdatedAt     time.Time
}

func (t storedTransfer) public() Transfer {
	return Transfer{
		Attempts:      t.Attempts,
		CompletedAt:   t.CompletedAt,
		ContentType:   t.ContentType,
		CreatedAt:     t.CreatedAt,
		DeadlineAt:    t.DeadlineAt,
		DeviceID:      t.DeviceID,
		Direction:     t.Direction,
		ID:            t.ID,
		LastError:     t.LastError,
		LocalPath:     t.LocalPath,
		Metadata:      decodeMetadata(t.MetadataJSON),
		NextAttemptAt: t.NextAttemptAt,
		ObjectKey:     t.ObjectKey,
		RemotePath:    t.RemotePath,
		Scope:         t.Scope,
		StartedAt:     t.StartedAt,
		State:         t.State,
		UpdatedAt:     t.UpdatedAt,
	}
}

func encodeMetadata(metadata map[string]string) string {
	if len(metadata) == 0 {
		return "{}"
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func decodeMetadata(raw string) map[string]string {
	if raw == "" {
		return map[string]string{}
	}
	var decoded map[string]string
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return map[string]string{}
	}
	if decoded == nil {
		return map[string]string{}
	}
	return decoded
}
