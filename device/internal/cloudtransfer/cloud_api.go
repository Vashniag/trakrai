package cloudtransfer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

type cloudAPIClient struct {
	authToken           string
	baseURL             string
	deviceID            string
	downloadPath        string
	httpClient          *http.Client
	packageDownloadPath string
	uploadPath          string
}

type presignRequest struct {
	ContentType string `json:"contentType,omitempty"`
	DeviceID    string `json:"deviceId"`
	Path        string `json:"path"`
}

type presignResponse struct {
	Bucket    string            `json:"bucket"`
	ExpiresAt string            `json:"expiresAt,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Method    string            `json:"method"`
	ObjectKey string            `json:"objectKey,omitempty"`
	URL       string            `json:"url"`
}

type packagePresignRequest struct {
	Path string `json:"path"`
}

func newCloudAPIClient(cfg *Config) *cloudAPIClient {
	return &cloudAPIClient{
		authToken:    cfg.CloudAPI.AuthToken,
		baseURL:      cfg.CloudAPI.BaseURL,
		deviceID:     cfg.DeviceID,
		downloadPath: cfg.CloudAPI.DownloadPresignPath,
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.CloudAPI.RequestTimeoutSec) * time.Second,
		},
		packageDownloadPath: cfg.CloudAPI.PackageDownloadPresignPath,
		uploadPath:          cfg.CloudAPI.UploadPresignPath,
	}
}

func (c *cloudAPIClient) PresignUpload(ctx context.Context, remotePath string, contentType string) (presignResponse, error) {
	return c.presign(ctx, "/"+strings.TrimPrefix(remotePath, "/"), contentType, "upload")
}

func (c *cloudAPIClient) PresignDownload(ctx context.Context, remotePath string) (presignResponse, error) {
	return c.presign(ctx, "/"+strings.TrimPrefix(remotePath, "/"), "", "download")
}

func (c *cloudAPIClient) PresignPackageDownload(ctx context.Context, remotePath string) (presignResponse, error) {
	return c.packagePresign(ctx, "/"+strings.TrimPrefix(remotePath, "/"))
}

func (c *cloudAPIClient) presign(ctx context.Context, remotePath string, contentType string, direction string) (presignResponse, error) {
	var endpointPath string
	switch direction {
	case "upload":
		endpointPath = c.uploadPath
	case "download":
		endpointPath = c.downloadPath
	default:
		return presignResponse{}, fmt.Errorf("unsupported presign direction %q", direction)
	}

	payload := presignRequest{
		ContentType: strings.TrimSpace(contentType),
		DeviceID:    c.deviceID,
		Path:        strings.TrimPrefix(path.Clean(remotePath), "/"),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return presignResponse{}, fmt.Errorf("marshal presign request: %w", err)
	}

	requestURL, err := url.JoinPath(c.baseURL, endpointPath)
	if err != nil {
		return presignResponse{}, fmt.Errorf("resolve presign url: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return presignResponse{}, fmt.Errorf("create presign request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if c.authToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.authToken)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return presignResponse{}, &temporaryError{message: fmt.Sprintf("cloud API request failed: %v", err)}
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil {
		return presignResponse{}, &temporaryError{message: fmt.Sprintf("read cloud API response: %v", err)}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(responseBody))
		if message == "" {
			message = fmt.Sprintf("cloud API returned HTTP %d", response.StatusCode)
		}
		if isRetryableHTTPStatus(response.StatusCode) {
			return presignResponse{}, &temporaryError{message: message}
		}
		return presignResponse{}, fmt.Errorf("%s", message)
	}

	var parsed presignResponse
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return presignResponse{}, fmt.Errorf("decode presign response: %w", err)
	}
	if strings.TrimSpace(parsed.Method) == "" {
		if direction == "upload" {
			parsed.Method = http.MethodPut
		} else {
			parsed.Method = http.MethodGet
		}
	}
	if strings.TrimSpace(parsed.URL) == "" {
		return presignResponse{}, fmt.Errorf("cloud API presign response did not include a url")
	}
	if parsed.Headers == nil {
		parsed.Headers = map[string]string{}
	}
	return parsed, nil
}

func (c *cloudAPIClient) packagePresign(ctx context.Context, remotePath string) (presignResponse, error) {
	payload := packagePresignRequest{
		Path: strings.TrimPrefix(path.Clean(remotePath), "/"),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return presignResponse{}, fmt.Errorf("marshal package presign request: %w", err)
	}

	requestURL, err := url.JoinPath(c.baseURL, c.packageDownloadPath)
	if err != nil {
		return presignResponse{}, fmt.Errorf("resolve package presign url: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return presignResponse{}, fmt.Errorf("create package presign request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if c.authToken != "" {
		request.Header.Set("Authorization", "Bearer "+c.authToken)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return presignResponse{}, &temporaryError{message: fmt.Sprintf("cloud API package request failed: %v", err)}
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil {
		return presignResponse{}, &temporaryError{message: fmt.Sprintf("read package presign response: %v", err)}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(responseBody))
		if message == "" {
			message = fmt.Sprintf("cloud API package presign returned HTTP %d", response.StatusCode)
		}
		if isRetryableHTTPStatus(response.StatusCode) {
			return presignResponse{}, &temporaryError{message: message}
		}
		return presignResponse{}, fmt.Errorf("%s", message)
	}

	var parsed presignResponse
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return presignResponse{}, fmt.Errorf("decode package presign response: %w", err)
	}
	if strings.TrimSpace(parsed.Method) == "" {
		parsed.Method = http.MethodGet
	}
	if strings.TrimSpace(parsed.URL) == "" {
		return presignResponse{}, fmt.Errorf("cloud API package presign response did not include a url")
	}
	if parsed.Headers == nil {
		parsed.Headers = map[string]string{}
	}
	return parsed, nil
}

func performPresignedUpload(ctx context.Context, httpClient *http.Client, presigned presignResponse, localPath string, contentType string) (string, error) {
	file, err := os.Open(localPath)
	if err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("open upload source %s: %v", localPath, err)}
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("stat upload source %s: %v", localPath, err)}
	}

	request, err := http.NewRequestWithContext(ctx, strings.ToUpper(presigned.Method), presigned.URL, file)
	if err != nil {
		return presigned.ObjectKey, fmt.Errorf("create upload request: %w", err)
	}
	request.ContentLength = info.Size()
	for key, value := range presigned.Headers {
		request.Header.Set(key, value)
	}
	if strings.TrimSpace(contentType) != "" && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", contentType)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("upload request failed: %v", err)}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 32*1024))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = fmt.Sprintf("upload returned HTTP %d", response.StatusCode)
		}
		if isRetryableHTTPStatus(response.StatusCode) {
			return presigned.ObjectKey, &temporaryError{message: message}
		}
		return presigned.ObjectKey, fmt.Errorf("%s", message)
	}
	return presigned.ObjectKey, nil
}

func performPresignedDownload(ctx context.Context, httpClient *http.Client, presigned presignResponse, localPath string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, strings.ToUpper(presigned.Method), presigned.URL, nil)
	if err != nil {
		return presigned.ObjectKey, fmt.Errorf("create download request: %w", err)
	}
	for key, value := range presigned.Headers {
		request.Header.Set(key, value)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("download request failed: %v", err)}
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 32*1024))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = fmt.Sprintf("download returned HTTP %d", response.StatusCode)
		}
		if isRetryableHTTPStatus(response.StatusCode) {
			return presigned.ObjectKey, &temporaryError{message: message}
		}
		return presigned.ObjectKey, fmt.Errorf("%s", message)
	}

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return presigned.ObjectKey, fmt.Errorf("create download directory: %w", err)
	}
	tempFile, err := os.CreateTemp(filepath.Dir(localPath), ".cloud-transfer-download-*")
	if err != nil {
		return presigned.ObjectKey, fmt.Errorf("create temp download file: %w", err)
	}
	tempPath := tempFile.Name()
	defer func() {
		tempFile.Close()
		_ = os.Remove(tempPath)
	}()

	if _, err := io.Copy(tempFile, response.Body); err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("write download file: %v", err)}
	}
	if err := tempFile.Close(); err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("close download file: %v", err)}
	}
	if err := os.Rename(tempPath, localPath); err != nil {
		return presigned.ObjectKey, &temporaryError{message: fmt.Sprintf("move download file into place: %v", err)}
	}
	return presigned.ObjectKey, nil
}

type temporaryError struct {
	message string
}

func (e *temporaryError) Error() string {
	return e.message
}

func isTemporaryError(err error) bool {
	var temp *temporaryError
	return errors.As(err, &temp)
}

func isRetryableHTTPStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusTooManyRequests ||
		statusCode >= 500
}
