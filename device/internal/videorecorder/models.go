package videorecorder

import (
	"time"

	"github.com/trakrai/device-services/internal/cloudtransfer"
)

const (
	videoRecorderErrorType  = "video-recorder-error"
	videoRecorderJobType    = "video-recorder-job"
	videoRecorderListType   = "video-recorder-list"
	videoRecorderPhotoType  = "video-recorder-photo"
	videoRecorderStatusType = "video-recorder-status"
)

type RecordingJobState string

const (
	JobStateCompleted     RecordingJobState = "completed"
	JobStateEncoding      RecordingJobState = "encoding"
	JobStateFailed        RecordingJobState = "failed"
	JobStateQueued        RecordingJobState = "queued"
	JobStateUploading     RecordingJobState = "uploading"
	JobStateWaitingBuffer RecordingJobState = "waiting_buffer"
)

type CapturePhotoRequest struct {
	CameraID   string `json:"cameraId,omitempty"`
	CameraName string `json:"cameraName,omitempty"`
	ImageID    string `json:"imageId,omitempty"`
	LocalPath  string `json:"localPath"`
	RequestID  string `json:"requestId,omitempty"`
}

type RecordClipRequest struct {
	CameraID    string                     `json:"cameraId,omitempty"`
	CameraName  string                     `json:"cameraName,omitempty"`
	Codec       string                     `json:"codec,omitempty"`
	ContentType string                     `json:"contentType,omitempty"`
	FrameRate   int                        `json:"frameRate,omitempty"`
	ImageID     string                     `json:"imageId,omitempty"`
	LocalPath   string                     `json:"localPath"`
	Metadata    map[string]string          `json:"metadata,omitempty"`
	PostSeconds float64                    `json:"postSeconds,omitempty"`
	PreSeconds  float64                    `json:"preSeconds,omitempty"`
	RemotePath  string                     `json:"remotePath"`
	RequestID   string                     `json:"requestId,omitempty"`
	Scope       cloudtransfer.StorageScope `json:"scope,omitempty"`
	Timeout     string                     `json:"timeout,omitempty"`
}

type GetJobRequest struct {
	JobID     string `json:"jobId"`
	RequestID string `json:"requestId,omitempty"`
}

type ListJobsRequest struct {
	Limit     int    `json:"limit,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

type StatusRequest struct {
	RequestID string `json:"requestId,omitempty"`
}

type PhotoCapture struct {
	Bytes      int       `json:"bytes"`
	CameraID   string    `json:"cameraId"`
	CameraName string    `json:"cameraName"`
	CapturedAt time.Time `json:"capturedAt"`
	ImageID    string    `json:"imageId"`
	LocalPath  string    `json:"localPath"`
}

type RecordingJob struct {
	CameraID    string                     `json:"cameraId"`
	CameraName  string                     `json:"cameraName"`
	CompletedAt *time.Time                 `json:"completedAt,omitempty"`
	Codec       string                     `json:"codec,omitempty"`
	ContentType string                     `json:"contentType,omitempty"`
	CreatedAt   time.Time                  `json:"createdAt"`
	Error       string                     `json:"error,omitempty"`
	EventAt     time.Time                  `json:"eventAt"`
	FrameCount  int                        `json:"frameCount"`
	FrameRate   int                        `json:"frameRate"`
	ID          string                     `json:"id"`
	ImageID     string                     `json:"imageId"`
	LocalPath   string                     `json:"localPath"`
	Metadata    map[string]string          `json:"metadata,omitempty"`
	PostSeconds float64                    `json:"postSeconds"`
	PreSeconds  float64                    `json:"preSeconds"`
	RemotePath  string                     `json:"remotePath"`
	Scope       cloudtransfer.StorageScope `json:"scope,omitempty"`
	StartedAt   *time.Time                 `json:"startedAt,omitempty"`
	State       RecordingJobState          `json:"state"`
	TransferID  string                     `json:"transferId,omitempty"`
	Timeout     string                     `json:"timeout,omitempty"`
	UpdatedAt   time.Time                  `json:"updatedAt"`
}

type RecorderJobPayload struct {
	Job       RecordingJob `json:"job"`
	RequestID string       `json:"requestId,omitempty"`
}

type RecorderPhotoPayload struct {
	Photo     PhotoCapture `json:"photo"`
	RequestID string       `json:"requestId,omitempty"`
}

type RecorderListPayload struct {
	Items     []RecordingJob `json:"items"`
	RequestID string         `json:"requestId,omitempty"`
}

type CameraBufferStatus struct {
	Bytes         int       `json:"bytes"`
	CameraID      string    `json:"cameraId"`
	CameraName    string    `json:"cameraName"`
	Frames        int       `json:"frames"`
	LatestAt      time.Time `json:"latestAt"`
	LatestImageID string    `json:"latestImageId"`
	OldestAt      time.Time `json:"oldestAt"`
}

type RecorderStats struct {
	CompletedJobs int `json:"completedJobs"`
	FailedJobs    int `json:"failedJobs"`
	PendingJobs   int `json:"pendingJobs"`
	RunningJobs   int `json:"runningJobs"`
	TotalJobs     int `json:"totalJobs"`
}

type RecorderStatusPayload struct {
	Buffers   []CameraBufferStatus `json:"buffers"`
	DeviceID  string               `json:"deviceId"`
	GStreamer string               `json:"gstreamer"`
	RequestID string               `json:"requestId,omitempty"`
	SharedDir string               `json:"sharedDir"`
	Stats     RecorderStats        `json:"stats"`
}

type RecorderErrorPayload struct {
	Error       string `json:"error"`
	RequestID   string `json:"requestId,omitempty"`
	RequestType string `json:"requestType,omitempty"`
}

type queuedJob struct {
	job RecordingJob
}
