package runtimemanager

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"
)

const tailReadChunkSize int64 = 16 * 1024

func readTailLines(path string, maxLines int) ([]string, bool, error) {
	if maxLines <= 0 {
		maxLines = 80
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, false, err
	}
	if info.IsDir() {
		return nil, false, fmt.Errorf("%s is a directory", path)
	}
	if info.Size() == 0 {
		return []string{}, false, nil
	}

	var buffer []byte
	var newlineCount int
	var offset = info.Size()

	for offset > 0 && newlineCount <= maxLines {
		chunkSize := tailReadChunkSize
		if offset < chunkSize {
			chunkSize = offset
		}
		offset -= chunkSize

		chunk := make([]byte, chunkSize)
		if _, err := file.ReadAt(chunk, offset); err != nil && err != io.EOF {
			return nil, false, err
		}

		buffer = append(chunk, buffer...)
		newlineCount = bytes.Count(buffer, []byte{'\n'})
	}

	trimmed := strings.TrimRight(string(buffer), "\r\n")
	if trimmed == "" {
		return []string{}, false, nil
	}

	lines := strings.Split(trimmed, "\n")
	truncated := len(lines) > maxLines
	if truncated {
		lines = lines[len(lines)-maxLines:]
	}

	for index := range lines {
		lines[index] = strings.TrimRight(lines[index], "\r")
	}

	return lines, truncated, nil
}
