package ainative

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Detection struct {
	Confidence float64
	Label      string
	Left       float64
	Top        float64
	Right      float64
	Bottom     float64
}

type InferenceResult struct {
	AnnotatedPath string
	Detections    []Detection
	LatencyMs     float64
}

type InferenceRequest struct {
	AnnotatedPath string
	Camera        CameraConfig
	FrameID       string
	InputPath     string
}

type Backend interface {
	Infer(context.Context, InferenceRequest) (InferenceResult, error)
	Close() error
}

type mockBackend struct{}

func (m *mockBackend) Infer(_ context.Context, request InferenceRequest) (InferenceResult, error) {
	return InferenceResult{AnnotatedPath: request.InputPath, Detections: nil, LatencyMs: 0}, nil
}

func (m *mockBackend) Close() error { return nil }

type processBackend struct {
	cfg    BackendConfig
	cmd    *exec.Cmd
	log    *slog.Logger
	mu     sync.Mutex
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

func newBackend(cfg BackendConfig, log *slog.Logger) (Backend, error) {
	switch strings.TrimSpace(cfg.Mode) {
	case "mock":
		return &mockBackend{}, nil
	default:
		return &processBackend{cfg: cfg, log: log}, nil
	}
}

func (b *processBackend) Infer(ctx context.Context, request InferenceRequest) (InferenceResult, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if err := b.ensureProcess(); err != nil {
		return InferenceResult{}, err
	}

	requestID := fmt.Sprintf("%s-%d", sanitizeField(request.FrameID), time.Now().UnixNano())
	line := fmt.Sprintf(
		"INFER\t%s\t%s\t%s\n",
		requestID,
		sanitizeField(request.InputPath),
		sanitizeField(request.AnnotatedPath),
	)
	if _, err := io.WriteString(b.stdin, line); err != nil {
		b.stopProcessLocked()
		return InferenceResult{}, fmt.Errorf("write backend request: %w", err)
	}

	responseCh := make(chan string, 1)
	errorCh := make(chan error, 1)
	go func() {
		line, err := b.stdout.ReadString('\n')
		if err != nil {
			errorCh <- err
			return
		}
		responseCh <- strings.TrimSpace(line)
	}()

	timeout := time.Duration(b.cfg.ResponseTimeoutMs) * time.Millisecond
	deadlineCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case <-deadlineCtx.Done():
		b.stopProcessLocked()
		return InferenceResult{}, fmt.Errorf("backend timeout after %s", timeout)
	case err := <-errorCh:
		b.stopProcessLocked()
		return InferenceResult{}, fmt.Errorf("read backend response: %w", err)
	case line := <-responseCh:
		result, err := parseBackendResponse(line, requestID, request.AnnotatedPath)
		if err != nil {
			return InferenceResult{}, err
		}
		return result, nil
	}
}

func (b *processBackend) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.stopProcessLocked()
	return nil
}

func (b *processBackend) ensureProcess() error {
	if b.cmd != nil && b.cmd.Process != nil {
		return nil
	}
	if len(b.cfg.Command) == 0 {
		return fmt.Errorf("backend.command is empty")
	}

	cmd := exec.Command(b.cfg.Command[0], b.cfg.Command[1:]...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("backend stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("backend stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("backend stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start backend: %w", err)
	}

	b.cmd = cmd
	b.stdin = stdin
	b.stdout = bufio.NewReader(stdout)
	go b.drainStderr(stderr)
	go func() {
		if err := cmd.Wait(); err != nil {
			b.log.Warn("native backend exited", "error", err)
		} else {
			b.log.Info("native backend stopped")
		}
		b.mu.Lock()
		if b.cmd == cmd {
			b.cmd = nil
			b.stdin = nil
			b.stdout = nil
		}
		b.mu.Unlock()
	}()
	b.log.Info("native backend started", "command", b.cfg.Command[0])
	return nil
}

func (b *processBackend) stopProcessLocked() {
	if b.stdin != nil {
		_ = b.stdin.Close()
	}
	if b.cmd != nil && b.cmd.Process != nil {
		_ = b.cmd.Process.Kill()
	}
	b.cmd = nil
	b.stdin = nil
	b.stdout = nil
}

func (b *processBackend) drainStderr(stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		b.log.Info("native-backend", "message", line)
	}
}

func parseBackendResponse(line string, expectedID string, defaultAnnotatedPath string) (InferenceResult, error) {
	parts := strings.SplitN(line, "\t", 4)
	if len(parts) < 3 {
		return InferenceResult{}, fmt.Errorf("invalid backend response %q", line)
	}
	switch parts[0] {
	case "ERR":
		if len(parts) >= 3 {
			return InferenceResult{}, fmt.Errorf(parts[2])
		}
		return InferenceResult{}, fmt.Errorf("backend error")
	case "OK":
	default:
		return InferenceResult{}, fmt.Errorf("unknown backend response %q", parts[0])
	}

	if parts[1] != expectedID {
		return InferenceResult{}, fmt.Errorf("backend response id mismatch: got %s want %s", parts[1], expectedID)
	}

	latencyMs, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return InferenceResult{}, fmt.Errorf("parse backend latency: %w", err)
	}

	detections := []Detection{}
	if len(parts) == 4 && strings.TrimSpace(parts[3]) != "" {
		entries := strings.Split(parts[3], ";")
		detections = make([]Detection, 0, len(entries))
		for _, entry := range entries {
			fields := strings.Split(entry, ",")
			if len(fields) != 6 {
				continue
			}
			confidence, err := strconv.ParseFloat(fields[1], 64)
			if err != nil {
				continue
			}
			left, leftErr := strconv.ParseFloat(fields[2], 64)
			top, topErr := strconv.ParseFloat(fields[3], 64)
			right, rightErr := strconv.ParseFloat(fields[4], 64)
			bottom, bottomErr := strconv.ParseFloat(fields[5], 64)
			if leftErr != nil || topErr != nil || rightErr != nil || bottomErr != nil {
				continue
			}
			detections = append(detections, Detection{
				Label:      fields[0],
				Confidence: confidence,
				Left:       left,
				Top:        top,
				Right:      right,
				Bottom:     bottom,
			})
		}
	}

	return InferenceResult{
		AnnotatedPath: defaultAnnotatedPath,
		Detections:    detections,
		LatencyMs:     latencyMs,
	}, nil
}

func sanitizeField(value string) string {
	value = strings.ReplaceAll(value, "\t", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}
