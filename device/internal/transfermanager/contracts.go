package transfermanager

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const ServiceName = "transfer-manager"

type CallbackTarget struct {
	Service  string `json:"service"`
	Subtopic string `json:"subtopic"`
}

type PresignRequest struct {
	Body    json.RawMessage   `json:"body,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Method  string            `json:"method,omitempty"`
	URL     string            `json:"url"`
}

type RetryPolicy struct {
	InitialBackoffMs int    `json:"initial_backoff_ms,omitempty"`
	MaxBackoffMs     int    `json:"max_backoff_ms,omitempty"`
	RetryUntil       string `json:"retry_until"`
}

type UploadTarget struct {
	Headers   map[string]string `json:"headers,omitempty"`
	Method    string            `json:"method,omitempty"`
	Presign   *PresignRequest   `json:"presign,omitempty"`
	SignedURL string            `json:"signed_url,omitempty"`
}

type DownloadTarget struct {
	Headers   map[string]string `json:"headers,omitempty"`
	Method    string            `json:"method,omitempty"`
	Presign   *PresignRequest   `json:"presign,omitempty"`
	SignedURL string            `json:"signed_url,omitempty"`
}

type TransferRequest struct {
	Callback     *CallbackTarget `json:"callback,omitempty"`
	ContentType  string          `json:"content_type,omitempty"`
	Download     *DownloadTarget `json:"download,omitempty"`
	Direction    string          `json:"direction"`
	LocalPath    string          `json:"local_path"`
	Metadata     map[string]any  `json:"metadata,omitempty"`
	ObjectKey    string          `json:"object_key"`
	OwnerService string          `json:"owner_service"`
	Retry        RetryPolicy     `json:"retry"`
	TransferID   string          `json:"transfer_id"`
	Upload       *UploadTarget   `json:"upload,omitempty"`
}

func (r *TransferRequest) Validate() error {
	if strings.TrimSpace(r.TransferID) == "" {
		return fmt.Errorf("transfer_id is required")
	}
	if strings.TrimSpace(r.OwnerService) == "" {
		return fmt.Errorf("owner_service is required")
	}
	if strings.TrimSpace(r.Direction) == "" {
		return fmt.Errorf("direction is required")
	}
	switch strings.ToLower(strings.TrimSpace(r.Direction)) {
	case "upload", "download":
	default:
		return fmt.Errorf("unsupported direction %q", r.Direction)
	}
	if strings.TrimSpace(r.ObjectKey) == "" {
		return fmt.Errorf("object_key is required")
	}
	if strings.TrimSpace(r.LocalPath) == "" {
		return fmt.Errorf("local_path is required")
	}
	if _, err := r.Retry.RetryDeadline(); err != nil {
		return err
	}
	if strings.EqualFold(r.Direction, "upload") {
		if r.Upload == nil {
			return fmt.Errorf("upload target is required for upload jobs")
		}
		if strings.TrimSpace(r.Upload.SignedURL) == "" && r.Upload.Presign == nil {
			return fmt.Errorf("signed_url or presign is required for upload jobs")
		}
	}
	if strings.EqualFold(r.Direction, "download") {
		if r.Download == nil {
			return fmt.Errorf("download target is required for download jobs")
		}
		if strings.TrimSpace(r.Download.SignedURL) == "" && r.Download.Presign == nil {
			return fmt.Errorf("signed_url or presign is required for download jobs")
		}
	}
	return nil
}

func (r RetryPolicy) RetryDeadline() (time.Time, error) {
	value := strings.TrimSpace(r.RetryUntil)
	if value == "" {
		return time.Time{}, fmt.Errorf("retry.retry_until is required")
	}
	deadline, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid retry.retry_until: %w", err)
	}
	return deadline, nil
}

func (r RetryPolicy) NormalizedInitialBackoff() time.Duration {
	if r.InitialBackoffMs <= 0 {
		return time.Second
	}
	return time.Duration(r.InitialBackoffMs) * time.Millisecond
}

func (r RetryPolicy) NormalizedMaxBackoff() time.Duration {
	if r.MaxBackoffMs <= 0 {
		return 5 * time.Minute
	}
	return time.Duration(r.MaxBackoffMs) * time.Millisecond
}
