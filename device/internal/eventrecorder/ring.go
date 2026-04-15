package eventrecorder

import (
	"os"
	"sort"
	"sync"
	"time"
)

type frameRing struct {
	maxFrames int
	frames    []sampledFrameRef
}

func newFrameRing(maxFrames int) *frameRing {
	return &frameRing{maxFrames: maxFrames}
}

func (r *frameRing) add(frame sampledFrameRef) []string {
	if r.maxFrames <= 0 {
		return nil
	}

	r.frames = append(r.frames, frame)
	deleted := make([]string, 0, 1)
	for len(r.frames) > r.maxFrames {
		deleted = append(deleted, r.frames[0].Path)
		r.frames = append([]sampledFrameRef(nil), r.frames[1:]...)
	}
	return deleted
}

func (r *frameRing) window(start time.Time, end time.Time) []sampledFrameRef {
	if len(r.frames) == 0 {
		return nil
	}

	selected := make([]sampledFrameRef, 0, len(r.frames))
	for _, frame := range r.frames {
		if frame.CapturedAt.Before(start) || frame.CapturedAt.After(end) {
			continue
		}
		selected = append(selected, frame)
	}
	return selected
}

type frameStore struct {
	mu    sync.RWMutex
	rings map[string]*frameRing
}

func newFrameStore(cameras []CameraConfig, maxFrames int) *frameStore {
	rings := make(map[string]*frameRing, len(cameras))
	for _, camera := range cameras {
		rings[camera.Name] = newFrameRing(maxFrames)
	}
	return &frameStore{rings: rings}
}

func (s *frameStore) add(frame sampledFrameRef) {
	s.mu.Lock()
	ring, ok := s.rings[frame.CameraName]
	if !ok {
		ring = newFrameRing(1)
		s.rings[frame.CameraName] = ring
	}
	deleted := ring.add(frame)
	s.mu.Unlock()

	for _, path := range deleted {
		_ = os.Remove(path)
	}
}

func (s *frameStore) window(cameraName string, start time.Time, end time.Time) []sampledFrameRef {
	s.mu.RLock()
	ring := s.rings[cameraName]
	if ring == nil {
		s.mu.RUnlock()
		return nil
	}
	frames := ring.window(start, end)
	s.mu.RUnlock()
	return append([]sampledFrameRef(nil), frames...)
}

func alignFramesByTimeline(framesByCamera map[string][]sampledFrameRef) []time.Time {
	timelineSet := make(map[int64]struct{})
	for _, frames := range framesByCamera {
		for _, frame := range frames {
			timelineSet[frame.CapturedAt.UnixNano()] = struct{}{}
		}
	}

	timeline := make([]time.Time, 0, len(timelineSet))
	for unixNs := range timelineSet {
		timeline = append(timeline, time.Unix(0, unixNs).UTC())
	}
	sort.Slice(timeline, func(i int, j int) bool {
		return timeline[i].Before(timeline[j])
	})
	return timeline
}

func pickNearestFrame(frames []sampledFrameRef, target time.Time) (sampledFrameRef, bool) {
	if len(frames) == 0 {
		return sampledFrameRef{}, false
	}

	best := frames[0]
	bestDelta := durationAbs(frames[0].CapturedAt.Sub(target))
	for _, frame := range frames[1:] {
		delta := durationAbs(frame.CapturedAt.Sub(target))
		if delta < bestDelta {
			best = frame
			bestDelta = delta
		}
	}
	return best, true
}

func durationAbs(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
