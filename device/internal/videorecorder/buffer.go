package videorecorder

import (
	"sync"
	"time"
)

type frameEntry struct {
	imageID   string
	timestamp time.Time
	jpeg      []byte
}

type cameraBuffer struct {
	camera    CameraConfig
	duration  time.Duration
	maxBytes  int
	maxFrames int

	mu          sync.RWMutex
	frames      []frameEntry
	totalBytes  int
	lastImageID string
}

func newCameraBuffer(camera CameraConfig, duration time.Duration, maxBytes int, maxFrames int) *cameraBuffer {
	return &cameraBuffer{
		camera:    camera,
		duration:  duration,
		maxBytes:  maxBytes,
		maxFrames: maxFrames,
		frames:    make([]frameEntry, 0, maxFrames),
	}
}

func (b *cameraBuffer) addFrame(imageID string, timestamp time.Time, jpeg []byte) bool {
	if imageID == "" || len(jpeg) == 0 {
		return false
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if imageID == b.lastImageID {
		return false
	}

	frame := frameEntry{
		imageID:   imageID,
		timestamp: timestamp,
		jpeg:      append([]byte(nil), jpeg...),
	}
	b.frames = append(b.frames, frame)
	b.totalBytes += len(frame.jpeg)
	b.lastImageID = imageID
	b.pruneLocked(timestamp)
	return true
}

func (b *cameraBuffer) snapshotRange(start time.Time, end time.Time) []frameEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	items := make([]frameEntry, 0, len(b.frames))
	for _, frame := range b.frames {
		if frame.timestamp.Before(start) || frame.timestamp.After(end) {
			continue
		}
		items = append(items, cloneFrame(frame))
	}
	return items
}

func (b *cameraBuffer) nearestFrame(target time.Time) (frameEntry, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if len(b.frames) == 0 {
		return frameEntry{}, false
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
	return cloneFrame(best), true
}

func (b *cameraBuffer) latestFrame() (frameEntry, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if len(b.frames) == 0 {
		return frameEntry{}, false
	}
	return cloneFrame(b.frames[len(b.frames)-1]), true
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

func (b *cameraBuffer) pruneLocked(now time.Time) {
	cutoff := now.Add(-b.duration)
	for len(b.frames) > 0 {
		first := b.frames[0]
		if !first.timestamp.Before(cutoff) && len(b.frames) <= b.maxFrames && b.totalBytes <= b.maxBytes {
			break
		}
		b.totalBytes -= len(first.jpeg)
		b.frames = b.frames[1:]
	}
}

func cloneFrame(frame frameEntry) frameEntry {
	return frameEntry{
		imageID:   frame.imageID,
		timestamp: frame.timestamp,
		jpeg:      append([]byte(nil), frame.jpeg...),
	}
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
