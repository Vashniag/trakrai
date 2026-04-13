package workflowcomm

import (
	"fmt"
	"strings"
	"time"
)

// Job is the Redis JSON contract consumed by workflow-comm.
//
// The workflow engine can enqueue either data-only jobs or jobs that include
// one or more local files. When files are present, the service performs the
// generic presign -> upload -> finalize flow described in the device planning
// document.
//
// Example payload:
//
//	{
//	  "id": "event-123",
//	  "kind": "violation-event",
//	  "data": {
//	    "cameraId": "cam-1",
//	    "violationLabels": ["no-helmet"]
//	  },
//	  "files": [
//	    {
//	      "tag": "snapshot",
//	      "path": "violations/cam-1/frame.jpg",
//	      "content_type": "image/jpeg"
//	    }
//	  ],
//	  "presign": {
//	    "url": "/api/external/device-workflow/presign-uploads",
//	    "method": "POST"
//	  },
//	  "finalize": {
//	    "url": "/api/external/device-workflow/store-event",
//	    "method": "POST"
//	  }
//	}
type Job struct {
	Version     int            `json:"version,omitempty"`
	ID          string         `json:"id"`
	Kind        string         `json:"kind,omitempty"`
	CreatedAt   string         `json:"created_at,omitempty"`
	Attempt     int            `json:"attempt,omitempty"`
	MaxAttempts int            `json:"max_attempts,omitempty"`
	LastError   string         `json:"last_error,omitempty"`
	Data        map[string]any `json:"data,omitempty"`
	Files       []FileSpec     `json:"files,omitempty"`
	Presign     *HTTPRequest   `json:"presign,omitempty"`
	Finalize    *HTTPRequest   `json:"finalize,omitempty"`
}

type FileSpec struct {
	Tag         string            `json:"tag,omitempty"`
	Path        string            `json:"path"`
	FileName    string            `json:"file_name,omitempty"`
	ContentType string            `json:"content_type,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
}

type HTTPRequest struct {
	URL        string            `json:"url"`
	Method     string            `json:"method,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Query      map[string]string `json:"query,omitempty"`
	Body       map[string]any    `json:"body,omitempty"`
	TimeoutSec int               `json:"timeout_sec,omitempty"`
	FilesField string            `json:"files_field,omitempty"`
}

type UploadTarget struct {
	Tag       string
	SignedURL string
	Method    string
	Key       string
	Headers   map[string]string
}

type UploadedFile struct {
	Tag         string            `json:"tag,omitempty"`
	FileName    string            `json:"fileName"`
	ContentType string            `json:"contentType"`
	SizeBytes   int64             `json:"sizeBytes"`
	Key         string            `json:"key"`
	Headers     map[string]string `json:"headers,omitempty"`
}

func normalizeJob(job Job) Job {
	if job.Version == 0 {
		job.Version = 1
	}
	job.Kind = strings.TrimSpace(job.Kind)
	if strings.TrimSpace(job.ID) == "" {
		job.ID = fmt.Sprintf("job-%d", time.Now().UnixNano())
	}
	if strings.TrimSpace(job.CreatedAt) == "" {
		job.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if job.Attempt < 0 {
		job.Attempt = 0
	}
	if job.Data == nil {
		job.Data = make(map[string]any)
	}
	if job.Presign != nil {
		job.Presign = normalizeRequest(job.Presign)
	}
	if job.Finalize != nil {
		job.Finalize = normalizeRequest(job.Finalize)
	}
	for index := range job.Files {
		job.Files[index].Tag = strings.TrimSpace(job.Files[index].Tag)
		job.Files[index].Path = strings.TrimSpace(job.Files[index].Path)
		job.Files[index].FileName = strings.TrimSpace(job.Files[index].FileName)
		job.Files[index].ContentType = strings.TrimSpace(job.Files[index].ContentType)
	}
	return job
}

func normalizeRequest(req *HTTPRequest) *HTTPRequest {
	if req == nil {
		return nil
	}
	copyReq := *req
	copyReq.URL = strings.TrimSpace(copyReq.URL)
	if copyReq.Method == "" {
		copyReq.Method = "POST"
	}
	copyReq.Method = strings.ToUpper(copyReq.Method)
	if copyReq.FilesField == "" {
		copyReq.FilesField = "files"
	}
	if copyReq.Headers == nil {
		copyReq.Headers = make(map[string]string)
	}
	if copyReq.Query == nil {
		copyReq.Query = make(map[string]string)
	}
	if copyReq.Body == nil {
		copyReq.Body = make(map[string]any)
	}
	return &copyReq
}

func (j Job) effectiveMaxAttempts(defaultMax int) int {
	if j.MaxAttempts > 0 {
		return j.MaxAttempts
	}
	if defaultMax > 0 {
		return defaultMax
	}
	return 1
}
