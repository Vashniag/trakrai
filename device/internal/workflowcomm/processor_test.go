package workflowcomm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProcessorHandlesPresignUploadFinalize(t *testing.T) {
	t.Parallel()

	filesRoot := t.TempDir()
	imagePath := filepath.Join(filesRoot, "frame.jpg")
	if err := os.WriteFile(imagePath, []byte("hello-image"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	var presignBody map[string]any
	var finalizeBody map[string]any
	uploadedBytes := []byte{}

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/presign":
			if err := json.NewDecoder(r.Body).Decode(&presignBody); err != nil {
				t.Fatalf("decode presign body: %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"uploads": []map[string]any{
					{
						"tag":       "snapshot",
						"signedUrl": server.URL + "/upload/snapshot",
						"key":       "events/frame.jpg",
					},
				},
			})
		case "/upload/snapshot":
			var err error
			uploadedBytes, err = io.ReadAll(r.Body)
			if err != nil {
				t.Fatalf("read upload body: %v", err)
			}
			w.WriteHeader(http.StatusOK)
		case "/finalize":
			if err := json.NewDecoder(r.Body).Decode(&finalizeBody); err != nil {
				t.Fatalf("decode finalize body: %v", err)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	cfg := &Config{
		HTTP: HTTPConfig{
			BaseURL:           server.URL,
			DeviceAccessToken: "device-token",
			RequestTimeoutSec: 5,
			UploadTimeoutSec:  5,
			MaxRequestRetries: 2,
			InitialBackoffMs:  10,
			MaxBackoffSec:     1,
		},
		Storage: StorageConfig{
			FilesRoot: filesRoot,
		},
	}
	processor := NewProcessor(cfg)

	result, err := processor.ProcessJob(context.Background(), Job{
		ID:   "job-1",
		Kind: "violation-event",
		Data: map[string]any{
			"cameraId": "cam-1",
		},
		Files: []FileSpec{
			{
				Tag:         "snapshot",
				Path:        "frame.jpg",
				ContentType: "image/jpeg",
			},
		},
		Presign: &HTTPRequest{
			URL: "/presign",
		},
		Finalize: &HTTPRequest{
			URL: "/finalize",
		},
	})
	if err != nil {
		t.Fatalf("process job: %v", err)
	}

	if got, want := string(uploadedBytes), "hello-image"; got != want {
		t.Fatalf("uploaded body mismatch: got %q want %q", got, want)
	}
	if got := presignBody["jobId"]; got != "job-1" {
		t.Fatalf("presign jobId mismatch: got %#v", got)
	}
	if got := presignBody["deviceAccessToken"]; got != "device-token" {
		t.Fatalf("presign deviceAccessToken mismatch: got %#v", got)
	}
	files, ok := finalizeBody["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("finalize files missing: %#v", finalizeBody["files"])
	}
	fileMap, ok := files[0].(map[string]any)
	if !ok {
		t.Fatalf("finalize file entry invalid: %#v", files[0])
	}
	if got := fileMap["key"]; got != "events/frame.jpg" {
		t.Fatalf("finalize key mismatch: got %#v", got)
	}
	if len(result.UploadedFiles) != 1 || result.UploadedFiles[0].Key != "events/frame.jpg" {
		t.Fatalf("unexpected process result: %#v", result)
	}
}

func TestProcessorSendsDataOnlyFinalize(t *testing.T) {
	t.Parallel()

	var finalizeBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/event" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&finalizeBody); err != nil {
			t.Fatalf("decode finalize body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &Config{
		HTTP: HTTPConfig{
			BaseURL:           server.URL,
			DeviceAccessToken: "device-token",
			RequestTimeoutSec: 5,
			UploadTimeoutSec:  5,
			MaxRequestRetries: 2,
			InitialBackoffMs:  10,
			MaxBackoffSec:     1,
		},
	}
	processor := NewProcessor(cfg)

	_, err := processor.ProcessJob(context.Background(), Job{
		ID:   "job-data",
		Kind: "health-event",
		Data: map[string]any{
			"cameraId": "cam-2",
			"status":   "online",
		},
		Finalize: &HTTPRequest{
			URL: "/event",
		},
	})
	if err != nil {
		t.Fatalf("process data-only job: %v", err)
	}

	if got := finalizeBody["cameraId"]; got != "cam-2" {
		t.Fatalf("cameraId mismatch: got %#v", got)
	}
	if got := finalizeBody["deviceAccessToken"]; got != "device-token" {
		t.Fatalf("deviceAccessToken mismatch: got %#v", got)
	}
	if got := finalizeBody["jobType"]; got != "health-event" {
		t.Fatalf("jobType mismatch: got %#v", got)
	}
}

func TestResolveFilesRejectsPathOutsideRoot(t *testing.T) {
	t.Parallel()

	filesRoot := t.TempDir()
	outsideFile := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outsideFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	processor := NewProcessor(&Config{
		Storage: StorageConfig{
			FilesRoot: filesRoot,
		},
	})

	_, err := processor.resolveFiles([]FileSpec{{Path: outsideFile}})
	if err == nil {
		t.Fatal("expected resolveFiles to reject path outside root")
	}
}

func TestComputeBackoffCapsAtMax(t *testing.T) {
	t.Parallel()

	delay := computeBackoff(500*time.Millisecond, 4*time.Second, 10)
	if delay != 4*time.Second {
		t.Fatalf("backoff cap mismatch: got %s", delay)
	}
}
