package workflowcomm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Processor struct {
	cfg *Config
	log *slog.Logger
}

type ProcessResult struct {
	UploadedFiles    []UploadedFile
	FinalizeResponse json.RawMessage
}

type resolvedFile struct {
	tag         string
	path        string
	fileName    string
	contentType string
	sizeBytes   int64
	headers     map[string]string
}

func NewProcessor(cfg *Config) *Processor {
	return &Processor{
		cfg: cfg,
		log: slog.With("component", ServiceName, "part", "processor"),
	}
}

func (p *Processor) ProcessJob(ctx context.Context, job Job) (*ProcessResult, error) {
	job = normalizeJob(job)
	if job.Presign == nil && job.Finalize == nil {
		return nil, fmt.Errorf("job %q must define presign and/or finalize request", job.ID)
	}

	files, err := p.resolveFiles(job.Files)
	if err != nil {
		return nil, fmt.Errorf("job %q resolve files: %w", job.ID, err)
	}
	if len(files) > 0 && job.Presign == nil {
		return nil, fmt.Errorf("job %q has files but no presign request", job.ID)
	}

	uploadedFiles := make([]UploadedFile, 0, len(files))
	if len(files) > 0 {
		presignResp, err := p.doJSONRequest(ctx, job, job.Presign, p.buildPresignBody(job, files))
		if err != nil {
			return nil, fmt.Errorf("job %q presign request failed: %w", job.ID, err)
		}

		targets, err := parseUploadTargets(presignResp)
		if err != nil {
			return nil, fmt.Errorf("job %q invalid presign response: %w", job.ID, err)
		}

		for _, file := range files {
			target, err := matchUploadTarget(file, targets)
			if err != nil {
				return nil, fmt.Errorf("job %q upload target mismatch: %w", job.ID, err)
			}
			if err := p.uploadFile(ctx, file, target); err != nil {
				return nil, fmt.Errorf("job %q upload %q failed: %w", job.ID, file.fileName, err)
			}
			uploadedFiles = append(uploadedFiles, UploadedFile{
				Tag:         file.tag,
				FileName:    file.fileName,
				ContentType: file.contentType,
				SizeBytes:   file.sizeBytes,
				Key:         target.Key,
				Headers:     cloneStringMap(target.Headers),
			})
		}
	}

	var finalizeResp json.RawMessage
	if job.Finalize != nil {
		finalizeResp, err = p.doJSONRequest(ctx, job, job.Finalize, p.buildFinalizeBody(job, uploadedFiles))
		if err != nil {
			return nil, fmt.Errorf("job %q finalize request failed: %w", job.ID, err)
		}
	}

	if p.cfg.Storage.DeleteUploadedFiles {
		for _, file := range files {
			if err := os.Remove(file.path); err != nil && !os.IsNotExist(err) {
				p.log.Warn("uploaded file cleanup failed", "job_id", job.ID, "path", file.path, "error", err)
			}
		}
	}

	return &ProcessResult{
		UploadedFiles:    uploadedFiles,
		FinalizeResponse: finalizeResp,
	}, nil
}

func (p *Processor) resolveFiles(files []FileSpec) ([]resolvedFile, error) {
	if len(files) == 0 {
		return nil, nil
	}

	rootAbs := ""
	if p.cfg.Storage.FilesRoot != "" {
		abs, err := filepath.Abs(p.cfg.Storage.FilesRoot)
		if err != nil {
			return nil, fmt.Errorf("resolve files_root: %w", err)
		}
		rootAbs = abs
	}

	resolved := make([]resolvedFile, 0, len(files))
	seenTags := make(map[string]struct{})
	requireTag := len(files) > 1

	for _, file := range files {
		if file.Path == "" {
			return nil, fmt.Errorf("file path is required")
		}
		if requireTag && file.Tag == "" {
			return nil, fmt.Errorf("file tag is required when multiple files are present")
		}
		if file.Tag != "" {
			if _, exists := seenTags[file.Tag]; exists {
				return nil, fmt.Errorf("duplicate file tag %q", file.Tag)
			}
			seenTags[file.Tag] = struct{}{}
		}

		resolvedPath := file.Path
		if rootAbs != "" {
			if filepath.IsAbs(resolvedPath) {
				rel, err := filepath.Rel(rootAbs, resolvedPath)
				if err != nil {
					return nil, fmt.Errorf("resolve file %q: %w", resolvedPath, err)
				}
				if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
					return nil, fmt.Errorf("file %q is outside storage.files_root", resolvedPath)
				}
			} else {
				resolvedPath = filepath.Join(rootAbs, resolvedPath)
			}
		}

		absPath, err := filepath.Abs(resolvedPath)
		if err != nil {
			return nil, fmt.Errorf("resolve file %q: %w", resolvedPath, err)
		}
		if rootAbs != "" {
			rel, err := filepath.Rel(rootAbs, absPath)
			if err != nil {
				return nil, fmt.Errorf("resolve file %q: %w", absPath, err)
			}
			if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				return nil, fmt.Errorf("file %q is outside storage.files_root", absPath)
			}
		}

		info, err := os.Stat(absPath)
		if err != nil {
			return nil, fmt.Errorf("stat %q: %w", absPath, err)
		}
		if info.IsDir() {
			return nil, fmt.Errorf("file %q is a directory", absPath)
		}

		fileName := file.FileName
		if fileName == "" {
			fileName = filepath.Base(absPath)
		}
		contentType := file.ContentType
		if contentType == "" {
			contentType = mime.TypeByExtension(filepath.Ext(fileName))
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}

		resolved = append(resolved, resolvedFile{
			tag:         file.Tag,
			path:        absPath,
			fileName:    fileName,
			contentType: contentType,
			sizeBytes:   info.Size(),
			headers:     cloneStringMap(file.Headers),
		})
	}

	return resolved, nil
}

func (p *Processor) buildPresignBody(job Job, files []resolvedFile) map[string]any {
	body := mergeMaps(job.Data, job.Presign.Body)
	body["jobId"] = job.ID
	if job.Kind != "" {
		body["jobType"] = job.Kind
	}
	body[job.Presign.FilesField] = describeFiles(files)
	return body
}

func (p *Processor) buildFinalizeBody(job Job, uploaded []UploadedFile) map[string]any {
	req := job.Finalize
	body := mergeMaps(job.Data, req.Body)
	body["jobId"] = job.ID
	if job.Kind != "" {
		body["jobType"] = job.Kind
	}
	if len(uploaded) > 0 {
		items := make([]map[string]any, 0, len(uploaded))
		for _, file := range uploaded {
			entry := map[string]any{
				"fileName":    file.FileName,
				"contentType": file.ContentType,
				"sizeBytes":   file.SizeBytes,
				"key":         file.Key,
			}
			if file.Tag != "" {
				entry["tag"] = file.Tag
			}
			if len(file.Headers) > 0 {
				entry["headers"] = file.Headers
			}
			items = append(items, entry)
		}
		body[req.FilesField] = items
	}
	return body
}

func (p *Processor) doJSONRequest(ctx context.Context, job Job, reqSpec *HTTPRequest, body map[string]any) (json.RawMessage, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request body: %w", err)
	}

	method := reqSpec.Method
	if method == "" {
		method = http.MethodPost
	}
	requestURL, err := p.resolveRequestURL(reqSpec)
	if err != nil {
		return nil, err
	}

	query := requestURL.Query()
	for key, value := range reqSpec.Query {
		query.Set(key, value)
	}
	if len(payload) == 0 && p.cfg.HTTP.DeviceAccessToken != "" && query.Get("deviceAccessToken") == "" {
		query.Set("deviceAccessToken", p.cfg.HTTP.DeviceAccessToken)
	}
	requestURL.RawQuery = query.Encode()

	timeout := time.Duration(p.cfg.HTTP.RequestTimeoutSec) * time.Second
	if reqSpec.TimeoutSec > 0 {
		timeout = time.Duration(reqSpec.TimeoutSec) * time.Second
	}

	var responseBody []byte
	var lastErr error
	for attempt := 0; attempt < p.cfg.HTTP.MaxRequestRetries; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, timeout)
		requestBody := payload
		if len(requestBody) > 0 && p.cfg.HTTP.DeviceAccessToken != "" {
			requestBody = injectDeviceToken(requestBody, p.cfg.HTTP.DeviceAccessToken)
		}

		req, err := http.NewRequestWithContext(attemptCtx, method, requestURL.String(), bytes.NewReader(requestBody))
		if err != nil {
			cancel()
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		if len(requestBody) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		if p.cfg.HTTP.UserAgent != "" {
			req.Header.Set("User-Agent", p.cfg.HTTP.UserAgent)
		}
		for key, value := range reqSpec.Headers {
			req.Header.Set(key, value)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			lastErr = err
			if attempt < p.cfg.HTTP.MaxRequestRetries-1 {
				time.Sleep(computeBackoff(
					time.Duration(p.cfg.HTTP.InitialBackoffMs)*time.Millisecond,
					time.Duration(p.cfg.HTTP.MaxBackoffSec)*time.Second,
					attempt,
				))
				continue
			}
			return nil, err
		}

		responseBody, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		cancel()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return json.RawMessage(responseBody), nil
		}

		lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
		if !retryableStatus(resp.StatusCode) || attempt == p.cfg.HTTP.MaxRequestRetries-1 {
			return nil, lastErr
		}
		time.Sleep(computeBackoff(
			time.Duration(p.cfg.HTTP.InitialBackoffMs)*time.Millisecond,
			time.Duration(p.cfg.HTTP.MaxBackoffSec)*time.Second,
			attempt,
		))
	}

	return nil, lastErr
}

func (p *Processor) uploadFile(ctx context.Context, file resolvedFile, target UploadTarget) error {
	method := target.Method
	if method == "" {
		method = http.MethodPut
	}

	timeout := time.Duration(p.cfg.HTTP.UploadTimeoutSec) * time.Second
	var lastErr error
	for attempt := 0; attempt < p.cfg.HTTP.MaxRequestRetries; attempt++ {
		handle, err := os.Open(file.path)
		if err != nil {
			return fmt.Errorf("open file: %w", err)
		}

		attemptCtx, cancel := context.WithTimeout(ctx, timeout)
		req, err := http.NewRequestWithContext(attemptCtx, method, target.SignedURL, handle)
		if err != nil {
			cancel()
			_ = handle.Close()
			return err
		}

		headers := cloneStringMap(target.Headers)
		if headers == nil {
			headers = make(map[string]string)
		}
		for key, value := range file.headers {
			headers[key] = value
		}
		if _, exists := headers["Content-Type"]; !exists && file.contentType != "" {
			headers["Content-Type"] = file.contentType
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		if p.cfg.HTTP.UserAgent != "" {
			req.Header.Set("User-Agent", p.cfg.HTTP.UserAgent)
		}

		resp, err := http.DefaultClient.Do(req)
		_ = handle.Close()
		if err != nil {
			cancel()
			lastErr = err
			if attempt < p.cfg.HTTP.MaxRequestRetries-1 {
				time.Sleep(computeBackoff(
					time.Duration(p.cfg.HTTP.InitialBackoffMs)*time.Millisecond,
					time.Duration(p.cfg.HTTP.MaxBackoffSec)*time.Second,
					attempt,
				))
				continue
			}
			return err
		}

		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		cancel()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}

		lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		if !retryableStatus(resp.StatusCode) || attempt == p.cfg.HTTP.MaxRequestRetries-1 {
			return lastErr
		}
		time.Sleep(computeBackoff(
			time.Duration(p.cfg.HTTP.InitialBackoffMs)*time.Millisecond,
			time.Duration(p.cfg.HTTP.MaxBackoffSec)*time.Second,
			attempt,
		))
	}

	return lastErr
}

func (p *Processor) resolveRequestURL(reqSpec *HTTPRequest) (*url.URL, error) {
	if reqSpec == nil || reqSpec.URL == "" {
		return nil, fmt.Errorf("request url is required")
	}

	parsed, err := url.Parse(reqSpec.URL)
	if err != nil {
		return nil, fmt.Errorf("parse request url %q: %w", reqSpec.URL, err)
	}
	if parsed.IsAbs() {
		return parsed, nil
	}
	if p.cfg.HTTP.BaseURL == "" {
		return nil, fmt.Errorf("relative request url %q requires http.base_url", reqSpec.URL)
	}
	baseURL, err := url.Parse(p.cfg.HTTP.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse http.base_url: %w", err)
	}
	return baseURL.ResolveReference(parsed), nil
}

func describeFiles(files []resolvedFile) []map[string]any {
	items := make([]map[string]any, 0, len(files))
	for _, file := range files {
		entry := map[string]any{
			"fileName":    file.fileName,
			"contentType": file.contentType,
			"sizeBytes":   file.sizeBytes,
		}
		if file.tag != "" {
			entry["tag"] = file.tag
		}
		items = append(items, entry)
	}
	return items
}

func parseUploadTargets(raw json.RawMessage) (map[string]UploadTarget, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}

	listRaw, ok := payload["uploads"]
	if !ok {
		listRaw = payload["files"]
	}
	items, ok := listRaw.([]any)
	if !ok || len(items) == 0 {
		return nil, fmt.Errorf("response must contain uploads/files array")
	}

	targets := make(map[string]UploadTarget, len(items))
	for index, item := range items {
		itemMap, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("upload entry %d is invalid", index)
		}

		tag := asString(itemMap["tag"])
		key := firstNonEmptyString(itemMap["key"], itemMap["objectKey"], itemMap["object_key"], itemMap["s3Key"])
		signedURL := firstNonEmptyString(itemMap["signedUrl"], itemMap["signed_url"], itemMap["uploadUrl"], itemMap["url"])
		if signedURL == "" {
			return nil, fmt.Errorf("upload entry %d is missing signedUrl", index)
		}
		if key == "" {
			return nil, fmt.Errorf("upload entry %d is missing key", index)
		}
		method := strings.ToUpper(firstNonEmptyString(itemMap["method"], itemMap["uploadMethod"]))
		if method == "" {
			method = http.MethodPut
		}
		targetKey := tag
		if targetKey == "" {
			targetKey = fmt.Sprintf("__index_%d", index)
		}
		targets[targetKey] = UploadTarget{
			Tag:       tag,
			SignedURL: signedURL,
			Method:    method,
			Key:       key,
			Headers:   mapFromAny(itemMap["headers"]),
		}
	}
	return targets, nil
}

func matchUploadTarget(file resolvedFile, targets map[string]UploadTarget) (UploadTarget, error) {
	if file.tag != "" {
		target, ok := targets[file.tag]
		if !ok {
			return UploadTarget{}, fmt.Errorf("missing presign result for tag %q", file.tag)
		}
		return target, nil
	}
	if len(targets) == 1 {
		for _, target := range targets {
			return target, nil
		}
	}
	return UploadTarget{}, fmt.Errorf("single file without tag requires exactly one upload target")
}

func computeBackoff(initial time.Duration, max time.Duration, attempt int) time.Duration {
	if initial <= 0 {
		initial = 500 * time.Millisecond
	}
	if max <= 0 {
		max = 30 * time.Second
	}
	delay := initial
	for step := 0; step < attempt; step++ {
		delay *= 2
		if delay >= max {
			return max
		}
	}
	if delay > max {
		return max
	}
	return delay
}

func retryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code == http.StatusRequestTimeout || code >= 500
}

func mergeMaps(base map[string]any, override map[string]any) map[string]any {
	merged := make(map[string]any, len(base)+len(override))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range override {
		merged[key] = value
	}
	return merged
}

func injectDeviceToken(payload []byte, token string) []byte {
	if token == "" {
		return payload
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return payload
	}
	if _, exists := body["deviceAccessToken"]; !exists {
		body["deviceAccessToken"] = token
	}
	updated, err := json.Marshal(body)
	if err != nil {
		return payload
	}
	return updated
}

func cloneStringMap(source map[string]string) map[string]string {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func mapFromAny(value any) map[string]string {
	items, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	result := make(map[string]string, len(items))
	for key, item := range items {
		text := asString(item)
		if text != "" {
			result[key] = text
		}
	}
	return result
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text := asString(value); text != "" {
			return text
		}
	}
	return ""
}
