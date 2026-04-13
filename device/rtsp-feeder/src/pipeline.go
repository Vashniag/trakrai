package main

import "fmt"

// PipelineType identifies the GStreamer decode/encode strategy.
type PipelineType int

const (
	PipelineH265HW PipelineType = iota
	PipelineH264HW
	PipelineSoftware
)

func (p PipelineType) String() string {
	switch p {
	case PipelineH265HW:
		return "H.265 HW"
	case PipelineH264HW:
		return "H.264 HW"
	case PipelineSoftware:
		return "Software"
	default:
		return "Unknown"
	}
}

// PipelineOrder returns the ordered list of pipelines to attempt.
func PipelineOrder(method string) []PipelineType {
	switch method {
	case "h265_hw":
		return []PipelineType{PipelineH265HW}
	case "h264_hw":
		return []PipelineType{PipelineH264HW}
	case "software":
		return []PipelineType{PipelineSoftware}
	default: // "auto"
		return []PipelineType{PipelineH265HW, PipelineH264HW, PipelineSoftware}
	}
}

const sinkCaps = `appsink name=sink max-buffers=1 drop=true sync=false emit-signals=false`

// BuildPipelineDesc returns a gst_parse_launch description string.
func BuildPipelineDesc(pt PipelineType, cam CameraConfig) string {
	flip := 0
	if cam.Rotate180 {
		flip = 2
	}

	switch pt {
	case PipelineH265HW:
		return hwDesc("rtph265depay", "h265parse", cam, flip)
	case PipelineH264HW:
		return hwDesc("rtph264depay", "h264parse", cam, flip)
	case PipelineSoftware:
		return swDesc(cam, flip)
	default:
		return ""
	}
}

// Hardware pipeline: rtspsrc → depay → parse → nvv4l2decoder → nvvidconv → nvjpegenc → appsink
func hwDesc(depay, parse string, cam CameraConfig, flip int) string {
	return fmt.Sprintf(
		`rtspsrc location="%s" latency=%d protocols=%s ! `+
			`%s ! %s ! nvv4l2decoder ! `+
			`nvvidconv flip-method=%d ! `+
			`video/x-raw,width=%d,height=%d,format=I420 ! `+
			`nvjpegenc quality=%d ! %s`,
		cam.RTSPURL, cam.LatencyMS, cam.Protocols,
		depay, parse,
		flip,
		cam.Width, cam.Height,
		cam.JPEGQuality, sinkCaps,
	)
}

// Software pipeline: rtspsrc → decodebin → videoflip → videoconvert → videoscale → jpegenc → appsink
func swDesc(cam CameraConfig, flip int) string {
	flipPart := ""
	if flip != 0 {
		flipPart = "! videoflip method=rotate-180 "
	}
	return fmt.Sprintf(
		`rtspsrc location="%s" latency=%d protocols=%s ! `+
			`decodebin %s! videoconvert ! videoscale ! `+
			`video/x-raw,width=%d,height=%d,format=I420 ! `+
			`jpegenc quality=%d ! %s`,
		cam.RTSPURL, cam.LatencyMS, cam.Protocols,
		flipPart,
		cam.Width, cam.Height,
		cam.JPEGQuality, sinkCaps,
	)
}
