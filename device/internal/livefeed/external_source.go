package livefeed

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

type streamEndpoint struct {
	cameraNames []string
	frameSource LiveFrameSource
	host        string
	layoutMode  LiveLayoutMode
	name        string
	port        int
}

type externalStreamCatalog struct {
	packetTimeout time.Duration
	streams       []streamEndpoint
}

func newExternalStreamCatalog(cfg StreamSourceConfig) *externalStreamCatalog {
	if !cfg.Enabled || len(cfg.Streams) == 0 {
		return nil
	}

	streams := make([]streamEndpoint, 0, len(cfg.Streams))
	for _, item := range cfg.Streams {
		plan, err := NormalizeLiveLayoutPlan(item.LayoutMode, "", item.CameraNames, item.FrameSource)
		if err != nil {
			continue
		}
		streams = append(streams, streamEndpoint{
			cameraNames: slices.Clone(plan.CameraNames),
			frameSource: plan.FrameSource,
			host:        strings.TrimSpace(item.Host),
			layoutMode:  plan.Mode,
			name:        strings.TrimSpace(item.Name),
			port:        item.Port,
		})
	}
	if len(streams) == 0 {
		return nil
	}

	return &externalStreamCatalog{
		packetTimeout: time.Duration(cfg.PacketTimeoutMs) * time.Millisecond,
		streams:       streams,
	}
}

func (c *externalStreamCatalog) match(plan LiveLayoutPlan) (streamEndpoint, bool) {
	if c == nil {
		return streamEndpoint{}, false
	}
	for _, stream := range c.streams {
		if stream.layoutMode != plan.Mode || stream.frameSource != plan.FrameSource {
			continue
		}
		if slices.Equal(stream.cameraNames, plan.CameraNames) {
			return stream, true
		}
	}
	return streamEndpoint{}, false
}

func buildPacketReaderPipeline(stream streamEndpoint) string {
	return fmt.Sprintf(
		`udpsrc address="%s" port=%d caps="application/x-rtp,media=video,encoding-name=H264,payload=96,clock-rate=90000" ! `+
			`rtpjitterbuffer latency=0 drop-on-latency=true ! `+
			`rtph264depay ! h264parse config-interval=-1 disable-passthrough=false ! `+
			`video/x-h264,stream-format=byte-stream,alignment=au ! `+
			`appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false`,
		stream.host,
		stream.port,
	)
}
