package videorecorder

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const defaultSegmentFileMode = 0o644

type frameEntry struct {
	imageID   string
	timestamp time.Time
	jpeg      []byte
}

type bufferedFrame struct {
	imageID     string
	timestamp   time.Time
	segmentPath string
	offset      int64
	size        int
}

type segmentFile struct {
	file *os.File
	path string
	refs int
	size int64
}

type cameraBuffer struct {
	camera         CameraConfig
	duration       time.Duration
	maxBytes       int
	maxFrames      int
	segmentMaxByte int64
	rootDir        string

	mu            sync.RWMutex
	activeSegment *segmentFile
	frames        []bufferedFrame
	lastImageID   string
	nextSegmentID int64
	segments      map[string]*segmentFile
	totalBytes    int
}

func newCameraBuffer(
	camera CameraConfig,
	rootDir string,
	duration time.Duration,
	maxBytes int,
	maxFrames int,
	segmentMaxBytes int64,
) (*cameraBuffer, error) {
	cameraDir := filepath.Join(rootDir, sanitizeCameraDir(camera.ID, camera.Name))
	if err := os.RemoveAll(cameraDir); err != nil {
		return nil, fmt.Errorf("reset camera buffer dir: %w", err)
	}
	if err := os.MkdirAll(cameraDir, 0o755); err != nil {
		return nil, fmt.Errorf("create camera buffer dir: %w", err)
	}
	return &cameraBuffer{
		camera:         camera,
		duration:       duration,
		maxBytes:       maxBytes,
		maxFrames:      maxFrames,
		segmentMaxByte: segmentMaxBytes,
		rootDir:        cameraDir,
		frames:         make([]bufferedFrame, 0, maxFrames),
		segments:       map[string]*segmentFile{},
	}, nil
}

func (b *cameraBuffer) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for key, segment := range b.segments {
		_ = segment.file.Close()
		delete(b.segments, key)
	}
	b.activeSegment = nil
}

func (b *cameraBuffer) addFrame(imageID string, timestamp time.Time, jpeg []byte) (bool, error) {
	if imageID == "" || len(jpeg) == 0 {
		return false, nil
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if imageID == b.lastImageID {
		return false, nil
	}

	segment, err := b.ensureActiveSegmentLocked(len(jpeg))
	if err != nil {
		return false, err
	}
	offset := segment.size
	written, err := segment.file.Write(jpeg)
	if err != nil {
		return false, fmt.Errorf("append frame to segment: %w", err)
	}
	if written != len(jpeg) {
		return false, fmt.Errorf("append frame to segment: short write %d/%d", written, len(jpeg))
	}
	segment.size += int64(written)
	segment.refs++

	b.frames = append(b.frames, bufferedFrame{
		imageID:     imageID,
		timestamp:   timestamp,
		segmentPath: segment.path,
		offset:      offset,
		size:        len(jpeg),
	})
	b.totalBytes += len(jpeg)
	b.lastImageID = imageID
	if err := b.pruneLocked(timestamp); err != nil {
		return false, err
	}
	return true, nil
}

func (b *cameraBuffer) snapshotRange(start time.Time, end time.Time) []bufferedFrame {
	b.mu.RLock()
	defer b.mu.RUnlock()

	items := make([]bufferedFrame, 0, len(b.frames))
	for _, frame := range b.frames {
		if frame.timestamp.Before(start) || frame.timestamp.After(end) {
			continue
		}
		items = append(items, frame)
	}
	return items
}

func (b *cameraBuffer) nearestFrame(target time.Time) (frameEntry, bool, error) {
	b.mu.RLock()
	if len(b.frames) == 0 {
		b.mu.RUnlock()
		return frameEntry{}, false, nil
	}
	best := b.frames[len(b.frames)-1]
	bestDelta := absDuration(best.timestamp.Sub(target))
	for _, frame := range b.frames {
		delta := absDuration(frame.timestamp.Sub(target))
		if delta < bestDelta {
			best = frame
			bestDelta = delta
		}
	}
	b.mu.RUnlock()
	entry, err := b.readFrame(best)
	if err != nil {
		return frameEntry{}, false, err
	}
	return entry, true, nil
}

func (b *cameraBuffer) latestFrame() (frameEntry, bool, error) {
	b.mu.RLock()
	if len(b.frames) == 0 {
		b.mu.RUnlock()
		return frameEntry{}, false, nil
	}
	frame := b.frames[len(b.frames)-1]
	b.mu.RUnlock()
	entry, err := b.readFrame(frame)
	if err != nil {
		return frameEntry{}, false, err
	}
	return entry, true, nil
}

func (b *cameraBuffer) loadFrames(frames []bufferedFrame) ([]frameEntry, error) {
	items := make([]frameEntry, 0, len(frames))
	for _, frame := range frames {
		entry, err := b.readFrame(frame)
		if err != nil {
			return nil, err
		}
		items = append(items, entry)
	}
	return items, nil
}

func (b *cameraBuffer) status() CameraBufferStatus {
	b.mu.RLock()
	defer b.mu.RUnlock()

	status := CameraBufferStatus{
		Bytes:      b.totalBytes,
		CameraID:   b.camera.ID,
		CameraName: b.camera.Name,
		Frames:     len(b.frames),
	}
	if len(b.frames) > 0 {
		status.OldestAt = b.frames[0].timestamp
		status.LatestAt = b.frames[len(b.frames)-1].timestamp
		status.LatestImageID = b.frames[len(b.frames)-1].imageID
	}
	return status
}

func (b *cameraBuffer) ensureActiveSegmentLocked(frameSize int) (*segmentFile, error) {
	if b.activeSegment != nil && b.activeSegment.size+int64(frameSize) <= b.segmentMaxByte {
		return b.activeSegment, nil
	}
	if b.activeSegment != nil && b.activeSegment.refs <= 0 {
		if err := b.activeSegment.file.Close(); err != nil {
			return nil, fmt.Errorf("close rotated segment: %w", err)
		}
		if err := os.Remove(b.activeSegment.path); err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("remove rotated segment: %w", err)
		}
		delete(b.segments, b.activeSegment.path)
	}

	path := filepath.Join(b.rootDir, fmt.Sprintf("segment-%06d.bin", b.nextSegmentID))
	b.nextSegmentID++
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, defaultSegmentFileMode)
	if err != nil {
		return nil, fmt.Errorf("create segment file: %w", err)
	}
	segment := &segmentFile{
		file: file,
		path: path,
	}
	b.segments[path] = segment
	b.activeSegment = segment
	return segment, nil
}

func (b *cameraBuffer) pruneLocked(now time.Time) error {
	cutoff := now.Add(-b.duration)
	for len(b.frames) > 0 {
		first := b.frames[0]
		if !first.timestamp.Before(cutoff) && len(b.frames) <= b.maxFrames && b.totalBytes <= b.maxBytes {
			break
		}
		if segment := b.segments[first.segmentPath]; segment != nil {
			segment.refs--
			if segment.refs <= 0 && segment != b.activeSegment {
				if err := segment.file.Close(); err != nil {
					return fmt.Errorf("close pruned segment: %w", err)
				}
				if err := os.Remove(segment.path); err != nil && !os.IsNotExist(err) {
					return fmt.Errorf("remove pruned segment: %w", err)
				}
				delete(b.segments, segment.path)
			}
		}
		b.totalBytes -= first.size
		b.frames = b.frames[1:]
	}
	return nil
}

func (b *cameraBuffer) readFrame(frame bufferedFrame) (frameEntry, error) {
	file, err := os.Open(frame.segmentPath)
	if err != nil {
		return frameEntry{}, fmt.Errorf("open segment: %w", err)
	}
	defer file.Close()

	jpeg := make([]byte, frame.size)
	read, err := file.ReadAt(jpeg, frame.offset)
	if err != nil {
		return frameEntry{}, fmt.Errorf("read frame bytes: %w", err)
	}
	if read != len(jpeg) {
		return frameEntry{}, fmt.Errorf("read frame bytes: short read %d/%d", read, len(jpeg))
	}
	return frameEntry{
		imageID:   frame.imageID,
		timestamp: frame.timestamp,
		jpeg:      jpeg,
	}, nil
}

func sanitizeCameraDir(cameraID string, cameraName string) string {
	base := strings.TrimSpace(cameraID)
	if base == "" {
		base = strings.TrimSpace(cameraName)
	}
	if base == "" {
		base = "camera"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_")
	return replacer.Replace(base)
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
