package roiconfig

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func ensureDocument(path string) (Document, error) {
	document, err := loadDocument(path)
	if err != nil {
		return Document{}, err
	}
	if err := saveDocument(path, document, time.Now().UTC()); err != nil {
		return Document{}, err
	}
	return loadDocument(path)
}

func loadDocument(path string) (Document, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaultDocument(), nil
	}
	if err != nil {
		return Document{}, err
	}
	if strings.TrimSpace(string(data)) == "" {
		return defaultDocument(), nil
	}

	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		return Document{}, err
	}
	return normalizeDocument(document, "")
}

func saveDocument(path string, document Document, now time.Time) error {
	normalized, err := normalizeDocument(document, now.UTC().Format(time.RFC3339))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}
