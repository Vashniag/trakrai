package eventrecorder

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/trakrai/device-services/internal/workflowcomm"
)

func TestNormalizeCaptureRequest(t *testing.T) {
	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)
	request, err := normalizeCaptureRequest(captureEventPayload{
		CameraName:  "Cam-1",
		FrameSource: "processed",
		LayoutMode:  "single",
		PreSeconds:  10,
		PostSeconds: 20,
		StartedAt:   "2026-04-15T09:59:00Z",
		EndedAt:     "2026-04-15T09:59:30Z",
	}, now)
	if err != nil {
		t.Fatalf("normalizeCaptureRequest failed: %v", err)
	}
	if got, want := request.WindowStart.Format(time.RFC3339), "2026-04-15T09:58:50Z"; got != want {
		t.Fatalf("window start mismatch: got %s want %s", got, want)
	}
	if got, want := request.WindowEnd.Format(time.RFC3339), "2026-04-15T09:59:50Z"; got != want {
		t.Fatalf("window end mismatch: got %s want %s", got, want)
	}
}

func TestBuildWorkflowJobUsesRelativePath(t *testing.T) {
	job, err := buildWorkflowJob(&cloudUploadPayload{
		Enabled:  true,
		JobKind:  "violation-event",
		Presign:  &workflowcomm.HTTPRequest{URL: "/presign", Method: "POST", FilesField: "files"},
		Finalize: &workflowcomm.HTTPRequest{URL: "/finalize", Method: "POST", FilesField: "files"},
	}, captureResult{
		EventID: "evt-1",
		File: outputFile{
			AbsolutePath: filepath.Join("/var/lib/trakrai/workflow-comm/files", "recordings", "evt-1.mp4"),
			RelativePath: filepath.Join("recordings", "evt-1.mp4"),
		},
	})
	if err != nil {
		t.Fatalf("buildWorkflowJob failed: %v", err)
	}
	if got := job.Files[0].Path; got != filepath.Join("recordings", "evt-1.mp4") {
		t.Fatalf("relative path mismatch: got %s", got)
	}
}
