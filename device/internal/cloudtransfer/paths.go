package cloudtransfer

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
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
	duration, err := time.ParseDuration(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid timeout %q: %w", raw, err)
	}
	if duration <= 0 {
		return nil, fmt.Errorf("timeout must be greater than 0")
	}
	deadline := now.Add(duration)
	return &deadline, nil
}
