package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type config struct {
	Bucket     string
	Endpoint   string
	ListenAddr string
	Prefix     string
	SecretKey  string
	UseSSL     bool
	User       string
}

type presignRequest struct {
	ContentType string `json:"contentType,omitempty"`
	DeviceID    string `json:"deviceId"`
	Path        string `json:"path"`
}

type presignResponse struct {
	Bucket    string            `json:"bucket"`
	Headers   map[string]string `json:"headers,omitempty"`
	Method    string            `json:"method"`
	ObjectKey string            `json:"objectKey"`
	URL       string            `json:"url"`
}

type objectDebugResponse struct {
	Bucket    string `json:"bucket"`
	Exists    bool   `json:"exists"`
	ObjectKey string `json:"objectKey"`
	Size      int64  `json:"size,omitempty"`
}

func main() {
	cfg := loadConfig()
	client, err := connectMinIO(cfg)
	if err != nil {
		log.Fatalf("connect minio: %v", err)
	}
	if err := ensureBucket(client, cfg.Bucket); err != nil {
		log.Fatalf("ensure bucket: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"bucket":  cfg.Bucket,
			"service": "mock-cloud-api",
			"status":  "ok",
		})
	})
	mux.HandleFunc("/api/v1/device-storage/presign-upload", func(w http.ResponseWriter, r *http.Request) {
		handlePresign(w, r, client, cfg, http.MethodPut)
	})
	mux.HandleFunc("/api/v1/device-storage/presign-download", func(w http.ResponseWriter, r *http.Request) {
		handlePresign(w, r, client, cfg, http.MethodGet)
	})
	mux.HandleFunc("/api/v1/device-storage/debug/object", func(w http.ResponseWriter, r *http.Request) {
		handleDebugObject(w, r, client, cfg)
	})

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("mock-cloud-api listening on %s (bucket=%s endpoint=%s)", cfg.ListenAddr, cfg.Bucket, cfg.Endpoint)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() config {
	return config{
		Bucket:     normalizeDefault(os.Getenv("MOCK_CLOUD_API_BUCKET"), "trakrai-local"),
		Endpoint:   normalizeDefault(os.Getenv("MOCK_CLOUD_API_MINIO_ENDPOINT"), "minio:9000"),
		ListenAddr: normalizeDefault(os.Getenv("MOCK_CLOUD_API_LISTEN_ADDR"), ":8080"),
		Prefix:     normalizeDefault(os.Getenv("MOCK_CLOUD_API_PREFIX"), "devices"),
		SecretKey:  normalizeDefault(os.Getenv("MOCK_CLOUD_API_MINIO_SECRET_KEY"), "minioadmin"),
		UseSSL:     strings.EqualFold(os.Getenv("MOCK_CLOUD_API_MINIO_USE_SSL"), "true"),
		User:       normalizeDefault(os.Getenv("MOCK_CLOUD_API_MINIO_ACCESS_KEY"), "minioadmin"),
	}
}

func connectMinIO(cfg config) (*minio.Client, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.User, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, err
	}
	return client, nil
}

func ensureBucket(client *minio.Client, bucket string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		exists, err := client.BucketExists(ctx, bucket)
		if err == nil && exists {
			return nil
		}
		if err == nil {
			err = client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
			if err == nil {
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("bucket %s was not ready after retries", bucket)
}

func handlePresign(w http.ResponseWriter, r *http.Request, client *minio.Client, cfg config, method string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request presignRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid request: %v", err)})
		return
	}

	objectKey, err := scopedObjectKey(cfg.Prefix, request.DeviceID, request.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	expiry := 15 * time.Minute
	var presignedURL string
	switch method {
	case http.MethodPut:
		url, err := client.PresignedPutObject(context.Background(), cfg.Bucket, objectKey, expiry)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		presignedURL = url.String()
	case http.MethodGet:
		url, err := client.PresignedGetObject(context.Background(), cfg.Bucket, objectKey, expiry, nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		presignedURL = url.String()
	default:
		http.Error(w, "unsupported method", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, presignResponse{
		Bucket:    cfg.Bucket,
		Headers:   map[string]string{},
		Method:    method,
		ObjectKey: objectKey,
		URL:       presignedURL,
	})
}

func handleDebugObject(w http.ResponseWriter, r *http.Request, client *minio.Client, cfg config) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	objectKey, err := scopedObjectKey(cfg.Prefix, r.URL.Query().Get("deviceId"), r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	info, err := client.StatObject(r.Context(), cfg.Bucket, objectKey, minio.StatObjectOptions{})
	if err != nil {
		writeJSON(w, http.StatusOK, objectDebugResponse{
			Bucket:    cfg.Bucket,
			Exists:    false,
			ObjectKey: objectKey,
		})
		return
	}

	writeJSON(w, http.StatusOK, objectDebugResponse{
		Bucket:    cfg.Bucket,
		Exists:    true,
		ObjectKey: objectKey,
		Size:      info.Size,
	})
}

func scopedObjectKey(prefix string, deviceID string, rawPath string) (string, error) {
	normalizedDeviceID := strings.TrimSpace(deviceID)
	if normalizedDeviceID == "" {
		return "", fmt.Errorf("deviceId is required")
	}
	normalizedPath := strings.TrimSpace(rawPath)
	if normalizedPath == "" {
		return "", fmt.Errorf("path is required")
	}

	cleaned := path.Clean("/" + strings.ReplaceAll(normalizedPath, "\\", "/"))
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "" || cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("path is invalid")
	}

	return path.Join(prefix, normalizedDeviceID, cleaned), nil
}

func normalizeDefault(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response failed: %v", err)
	}
}
