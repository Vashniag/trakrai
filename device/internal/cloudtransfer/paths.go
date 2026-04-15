package cloudtransfer

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func normalizeRemotePath(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("remotePath is required")
	}
	for _, segment := range strings.Split(strings.ReplaceAll(trimmed, "\\", "/"), "/") {
		if strings.TrimSpace(segment) == ".." {
			return "", fmt.Errorf("remotePath cannot escape the device scope")
		}
	}

	normalized := path.Clean("/" + strings.ReplaceAll(trimmed, "\\", "/"))
	normalized = strings.TrimPrefix(normalized, "/")
	if normalized == "" || normalized == "." {
		return "", fmt.Errorf("remotePath is invalid")
	}
	if strings.HasPrefix(normalized, "../") || normalized == ".." {
		return "", fmt.Errorf("remotePath cannot escape the device scope")
	}
	return normalized, nil
}

func normalizeSharedPath(sharedDir string, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("localPath is required")
	}

	base := filepath.Clean(sharedDir)
	var resolved string
	if filepath.IsAbs(trimmed) {
		resolved = filepath.Clean(trimmed)
	} else {
		resolved = filepath.Clean(filepath.Join(base, trimmed))
	}

	if resolved != base && !strings.HasPrefix(resolved, base+string(os.PathSeparator)) {
		return "", fmt.Errorf("localPath must stay inside shared_dir")
	}
	return resolved, nil
}

func parseTimeoutWindow(raw string, now time.Time) (*time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	duration, err := parseTransferDuration(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid timeout %q: %w", raw, err)
	}
	if duration <= 0 {
		return nil, fmt.Errorf("timeout must be greater than 0")
	}
	deadline := now.Add(duration)
	return &deadline, nil
}

func parseTransferDuration(raw string) (time.Duration, error) {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	switch {
	case strings.HasSuffix(trimmed, "days"):
		return parseDayDuration(strings.TrimSuffix(trimmed, "days"))
	case strings.HasSuffix(trimmed, "day"):
		return parseDayDuration(strings.TrimSuffix(trimmed, "day"))
	case strings.HasSuffix(trimmed, "d"):
		return parseDayDuration(strings.TrimSuffix(trimmed, "d"))
	default:
		return time.ParseDuration(trimmed)
	}
}

func parseDayDuration(raw string) (time.Duration, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, err
	}
	return time.Duration(value * float64(24*time.Hour)), nil
}
