package transfermanager

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

func TestExecuteTransferUploadWithPresign(t *testing.T) {
	t.Parallel()

	uploadedBody := ""
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/presign":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"headers": map[string]string{
					"X-Test-Header": "ok",
				},
				"method": http.MethodPut,
				"url":    server.URL + "/upload",
			})
		case "/upload":
			body, _ := io.ReadAll(r.Body)
			uploadedBody = string(body)
			if r.Method != http.MethodPut {
				t.Fatalf("unexpected upload method %s", r.Method)
			}
			if got := r.Header.Get("X-Test-Header"); got != "ok" {
				t.Fatalf("expected X-Test-Header=ok, got %q", got)
			}
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "snapshot.jpg")
	if err := os.WriteFile(filePath, []byte("snapshot-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := &Config{
		HTTP: HTTPConfig{
			RequestTimeoutSec: 5,
			UserAgent:         "test-agent",
		},
	}
	service := &Service{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}

	request := TransferRequest{
		ContentType:  "image/jpeg",
		Direction:    "upload",
		LocalPath:    filePath,
		ObjectKey:    "violations/test/snapshot.jpg",
		OwnerService: "workflow-engine",
		Retry: RetryPolicy{
			RetryUntil: time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		},
		TransferID: "transfer-1",
		Upload: &UploadTarget{
			Presign: &PresignRequest{
				Method: http.MethodPost,
				URL:    server.URL + "/presign",
			},
		},
	}

	target, err := service.resolveUploadTarget(context.Background(), request)
	if err != nil {
		t.Fatalf("resolveUploadTarget failed: %v", err)
	}
	if err := service.uploadFile(context.Background(), request, target); err != nil {
		t.Fatalf("uploadFile failed: %v", err)
	}
	if uploadedBody != "snapshot-bytes" {
		t.Fatalf("unexpected uploaded body %q", uploadedBody)
	}
}

func TestExecuteTransferDownloadWithPresign(t *testing.T) {
	t.Parallel()

	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/presign-download":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"headers": map[string]string{
					"X-Download-Token": "ok",
				},
				"method": http.MethodGet,
				"url":    server.URL + "/download",
			})
		case "/download":
			if got := r.Header.Get("X-Download-Token"); got != "ok" {
				t.Fatalf("expected X-Download-Token=ok, got %q", got)
			}
			_, _ = w.Write([]byte("video-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "nested", "clip.mp4")

	cfg := &Config{
		HTTP: HTTPConfig{
			RequestTimeoutSec: 5,
			UserAgent:         "test-agent",
		},
	}
	service := &Service{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}

	request := TransferRequest{
		ContentType:  "video/mp4",
		Direction:    "download",
		LocalPath:    filePath,
		ObjectKey:    "violations/test/clip.mp4",
		OwnerService: "workflow-engine",
		Retry: RetryPolicy{
			RetryUntil: time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		},
		TransferID: "transfer-download-1",
		Download: &DownloadTarget{
			Presign: &PresignRequest{
				Method: http.MethodPost,
				URL:    server.URL + "/presign-download",
			},
		},
	}

	target, err := service.resolveDownloadTarget(context.Background(), request)
	if err != nil {
		t.Fatalf("resolveDownloadTarget failed: %v", err)
	}
	if err := service.downloadFile(context.Background(), request, target); err != nil {
		t.Fatalf("downloadFile failed: %v", err)
	}

	downloaded, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read downloaded file failed: %v", err)
	}
	if string(downloaded) != "video-bytes" {
		t.Fatalf("unexpected downloaded body %q", string(downloaded))
	}
}

func TestTransferRequestValidateRequiresDownloadTarget(t *testing.T) {
	t.Parallel()

	request := TransferRequest{
		Direction:    "download",
		LocalPath:    "/tmp/file.bin",
		ObjectKey:    "objects/file.bin",
		OwnerService: "workflow-engine",
		Retry: RetryPolicy{
			RetryUntil: time.Now().Add(time.Minute).UTC().Format(time.RFC3339),
		},
		TransferID: "download-1",
	}

	if err := request.Validate(); err == nil {
		t.Fatalf("expected missing download target to fail validation")
	}
}
