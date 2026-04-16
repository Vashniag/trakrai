package transfermanager

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type Service struct {
	cfg        *Config
	httpClient *http.Client
	ipcClient  *ipc.Client
	log        *slog.Logger
	store      *Store
}

type resolvedTarget struct {
	Headers map[string]string
	Method  string
	URL     string
}

type endpointSpec struct {
	defaultMethod  string
	directURL      string
	headers        map[string]string
	method         string
	presign        *PresignRequest
	responseURLKey []string
}

func Run(ctx context.Context, cfg *Config) error {
	store, err := OpenStore(cfg.Queue.DatabasePath)
	if err != nil {
		return err
	}
	defer store.Close()

	service := &Service{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.HTTP.RequestTimeoutSec) * time.Second,
		},
		ipcClient: ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		log:       slog.With("component", ServiceName),
		store:     store,
	}
	service.ipcClient.Start()
	defer service.ipcClient.Close()

	service.reportStatus("idle", nil)

	ticker := time.NewTicker(time.Duration(cfg.Queue.PollIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			service.reportStatus("stopped", map[string]any{"reason": "shutdown"})
			return nil
		case notification, ok := <-service.ipcClient.Notifications():
			if !ok {
				return nil
			}
			if err := service.handleNotification(ctx, notification); err != nil {
				service.log.Warn("transfer-manager notification failed", "error", err)
				_ = service.ipcClient.ReportError(err.Error(), false)
			}
		case <-ticker.C:
			if err := service.processDueJobs(ctx); err != nil {
				service.log.Warn("processing due transfers failed", "error", err)
				_ = service.ipcClient.ReportError(err.Error(), false)
			}
		}
	}
}

func (s *Service) handleNotification(ctx context.Context, notification ipc.Notification) error {
	if notification.Method != "service-message" {
		return nil
	}

	var message ipc.ServiceMessageNotification
	if err := json.Unmarshal(notification.Params, &message); err != nil {
		return fmt.Errorf("decode service-message: %w", err)
	}
	if message.Subtopic != "command" {
		return nil
	}

	switch message.Envelope.Type {
	case "enqueue-upload", "enqueue-download":
		var request TransferRequest
		if err := json.Unmarshal(message.Envelope.Payload, &request); err != nil {
			return fmt.Errorf("decode transfer request: %w", err)
		}
		if request.OwnerService == "" {
			request.OwnerService = message.SourceService
		}
		if err := request.Validate(); err != nil {
			return err
		}
		if err := s.store.Enqueue(ctx, request); err != nil {
			return err
		}
		s.reportStatus("queued", map[string]any{
			"direction":    request.Direction,
			"ownerService": request.OwnerService,
			"transferId":   request.TransferID,
		})
		if request.Callback != nil && request.Callback.Service != "" {
			s.notifyCallback(request, "transfer-queued", map[string]any{})
		}
		return nil
	default:
		return fmt.Errorf("unknown transfer command: %s", message.Envelope.Type)
	}
}

func (s *Service) processDueJobs(ctx context.Context) error {
	jobs, err := s.store.TakeDueJobs(ctx, s.cfg.Queue.MaxInFlight)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		s.reportStatus("processing", map[string]any{
			"direction":  job.Payload.Direction,
			"objectKey":  job.Payload.ObjectKey,
			"transferId": job.ID,
		})

		if err := s.executeTransfer(ctx, job.Payload); err != nil {
			attemptCount := job.AttemptCount + 1
			if time.Now().UTC().After(job.RetryUntil) {
				if markErr := s.store.MarkFailed(ctx, job.ID, attemptCount, err.Error()); markErr != nil {
					return markErr
				}
				s.notifyCallback(job.Payload, "transfer-failed", map[string]any{
					"attemptCount": attemptCount,
					"error":        err.Error(),
				})
				continue
			}

			nextAttempt := time.Now().UTC().Add(backoffForAttempt(
				job.Payload.Retry.NormalizedInitialBackoff(),
				job.Payload.Retry.NormalizedMaxBackoff(),
				attemptCount,
			))
			if nextAttempt.After(job.RetryUntil) {
				nextAttempt = job.RetryUntil
			}
			if markErr := s.store.MarkRetry(ctx, job.ID, attemptCount, nextAttempt, err.Error()); markErr != nil {
				return markErr
			}
			s.notifyCallback(job.Payload, "transfer-retrying", map[string]any{
				"attemptCount": attemptCount,
				"error":        err.Error(),
				"nextAttempt":  nextAttempt.Format(time.RFC3339),
			})
			continue
		}

		if err := s.store.MarkSucceeded(ctx, job.ID); err != nil {
			return err
		}
		s.notifyCallback(job.Payload, "transfer-complete", map[string]any{})
	}

	s.reportStatus("idle", nil)
	return nil
}

func (s *Service) executeTransfer(ctx context.Context, request TransferRequest) error {
	switch strings.ToLower(strings.TrimSpace(request.Direction)) {
	case "upload":
		target, err := s.resolveUploadTarget(ctx, request)
		if err != nil {
			return err
		}
		return s.uploadFile(ctx, request, target)
	case "download":
		target, err := s.resolveDownloadTarget(ctx, request)
		if err != nil {
			return err
		}
		return s.downloadFile(ctx, request, target)
	default:
		return fmt.Errorf("unsupported direction %q", request.Direction)
	}
}

func (s *Service) resolveUploadTarget(ctx context.Context, request TransferRequest) (*resolvedTarget, error) {
	if request.Upload == nil {
		return nil, fmt.Errorf("upload target is required")
	}
	return s.resolveEndpoint(ctx, endpointSpec{
		directURL:      request.Upload.SignedURL,
		headers:        request.Upload.Headers,
		method:         request.Upload.Method,
		presign:        request.Upload.Presign,
		defaultMethod:  http.MethodPut,
		responseURLKey: []string{"url", "signedUrl", "signed_url"},
	})
}

func (s *Service) resolveDownloadTarget(ctx context.Context, request TransferRequest) (*resolvedTarget, error) {
	if request.Download == nil {
		return nil, fmt.Errorf("download target is required")
	}
	return s.resolveEndpoint(ctx, endpointSpec{
		directURL:      request.Download.SignedURL,
		headers:        request.Download.Headers,
		method:         request.Download.Method,
		presign:        request.Download.Presign,
		defaultMethod:  http.MethodGet,
		responseURLKey: []string{"download_url", "downloadUrl", "url", "signedUrl", "signed_url"},
	})
}

func (s *Service) resolveEndpoint(ctx context.Context, spec endpointSpec) (*resolvedTarget, error) {
	if strings.TrimSpace(spec.directURL) != "" {
		return &resolvedTarget{
			Headers: spec.headers,
			Method:  defaultString(spec.method, spec.defaultMethod),
			URL:     spec.directURL,
		}, nil
	}
	if spec.presign == nil {
		return nil, fmt.Errorf("signed_url or presign is required")
	}

	presignURL, err := s.resolveURL(spec.presign.URL)
	if err != nil {
		return nil, err
	}

	method := defaultString(spec.presign.Method, http.MethodPost)
	body := bytes.NewReader(spec.presign.Body)
	httpRequest, err := http.NewRequestWithContext(ctx, method, presignURL, body)
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("User-Agent", s.cfg.HTTP.UserAgent)
	if len(spec.presign.Body) > 0 {
		httpRequest.Header.Set("Content-Type", "application/json")
	}
	for key, value := range spec.presign.Headers {
		httpRequest.Header.Set(key, value)
	}

	response, err := s.httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	bodyBytes, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("presign request failed with status %d: %s", response.StatusCode, string(bodyBytes))
	}

	var payload map[string]any
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return nil, fmt.Errorf("decode presign response: %w", err)
	}

	targetURL := firstString(payload, spec.responseURLKey...)
	if targetURL == "" {
		return nil, fmt.Errorf("presign response did not include a transfer URL")
	}
	headers := map[string]string{}
	if rawHeaders, ok := payload["headers"].(map[string]any); ok {
		for key, value := range rawHeaders {
			headers[key] = fmt.Sprint(value)
		}
	}
	for key, value := range spec.headers {
		headers[key] = value
	}

	return &resolvedTarget{
		Headers: headers,
		Method:  defaultString(firstString(payload, "method"), defaultString(spec.method, spec.defaultMethod)),
		URL:     targetURL,
	}, nil
}

func (s *Service) uploadFile(ctx context.Context, request TransferRequest, target *resolvedTarget) error {
	fileBytes, err := os.ReadFile(filepath.Clean(request.LocalPath))
	if err != nil {
		return fmt.Errorf("read upload file: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(ctx, target.Method, target.URL, bytes.NewReader(fileBytes))
	if err != nil {
		return err
	}
	httpRequest.Header.Set("User-Agent", s.cfg.HTTP.UserAgent)
	if request.ContentType != "" {
		httpRequest.Header.Set("Content-Type", request.ContentType)
	}
	for key, value := range target.Headers {
		httpRequest.Header.Set(key, value)
	}

	response, err := s.httpClient.Do(httpRequest)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("upload failed with status %d: %s", response.StatusCode, string(bodyBytes))
	}

	return nil
}

func (s *Service) downloadFile(ctx context.Context, request TransferRequest, target *resolvedTarget) error {
	httpRequest, err := http.NewRequestWithContext(ctx, target.Method, target.URL, nil)
	if err != nil {
		return err
	}
	httpRequest.Header.Set("User-Agent", s.cfg.HTTP.UserAgent)
	if request.ContentType != "" {
		httpRequest.Header.Set("Accept", request.ContentType)
	}
	for key, value := range target.Headers {
		httpRequest.Header.Set(key, value)
	}

	response, err := s.httpClient.Do(httpRequest)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("download failed with status %d: %s", response.StatusCode, string(bodyBytes))
	}

	localPath := filepath.Clean(request.LocalPath)
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("create download dir: %w", err)
	}
	tempPath := localPath + ".part"
	file, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("create download file: %w", err)
	}

	copyErr := error(nil)
	if _, err := io.Copy(file, response.Body); err != nil {
		copyErr = fmt.Errorf("write download file: %w", err)
	}
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return closeErr
	}
	if err := os.Rename(tempPath, localPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("commit download file: %w", err)
	}
	return nil
}

func (s *Service) resolveURL(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", fmt.Errorf("request URL is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if parsed.IsAbs() {
		return parsed.String(), nil
	}
	base, err := url.Parse(strings.TrimSpace(s.cfg.HTTP.BaseURL))
	if err != nil {
		return "", fmt.Errorf("invalid http.base_url: %w", err)
	}
	return base.ResolveReference(parsed).String(), nil
}

func (s *Service) notifyCallback(request TransferRequest, messageType string, payload map[string]any) {
	if request.Callback == nil || request.Callback.Service == "" {
		return
	}

	merged := map[string]any{
		"direction":    request.Direction,
		"localPath":    request.LocalPath,
		"objectKey":    request.ObjectKey,
		"ownerService": request.OwnerService,
		"transferId":   request.TransferID,
	}
	for key, value := range payload {
		merged[key] = value
	}

	if err := s.ipcClient.SendServiceMessage(
		request.Callback.Service,
		defaultSubtopic(request.Callback.Subtopic, "transfer/response"),
		messageType,
		merged,
	); err != nil {
		s.log.Debug("transfer callback failed", "error", err)
	}
}

func (s *Service) reportStatus(status string, extra map[string]any) {
	counts, err := s.store.Counts(context.Background())
	if err != nil {
		counts = map[string]int{}
	}
	details := map[string]any{
		"completed":  counts["completed"],
		"database":   s.cfg.Queue.DatabasePath,
		"failed":     counts["failed"],
		"processing": counts["processing"],
		"queued":     counts["queued"],
		"retrying":   counts["retrying"],
	}
	for key, value := range extra {
		details[key] = value
	}
	if err := s.ipcClient.ReportStatus(status, details); err != nil {
		s.log.Debug("transfer-manager status report failed", "error", err)
	}
}

func backoffForAttempt(initial time.Duration, max time.Duration, attempt int) time.Duration {
	if attempt <= 1 {
		return initial
	}
	delay := initial
	for current := 1; current < attempt; current++ {
		delay *= 2
		if delay >= max {
			return max
		}
	}
	return delay
}

func defaultString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func defaultSubtopic(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			if asString := strings.TrimSpace(fmt.Sprint(value)); asString != "" {
				return asString
			}
		}
	}
	return ""
}
