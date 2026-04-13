package rtspfeeder

import "fmt"

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

func PipelineOrder(method string) []PipelineType {
	switch method {
	case "h265_hw":
		return []PipelineType{PipelineH265HW}
	case "h264_hw":
		return []PipelineType{PipelineH264HW}
	case "software":
		return []PipelineType{PipelineSoftware}
	default:
		return []PipelineType{PipelineH265HW, PipelineH264HW, PipelineSoftware}
	}
}

const sinkCaps = `appsink name=sink max-buffers=1 drop=true sync=false emit-signals=false`

func BuildPipelineDesc(pipelineType PipelineType, camera CameraConfig) string {
	flip := 0
	if camera.Rotate180 {
		flip = 2
	}

	switch pipelineType {
	case PipelineH265HW:
		return hwDesc("rtph265depay", "h265parse", camera, flip)
	case PipelineH264HW:
		return hwDesc("rtph264depay", "h264parse", camera, flip)
	case PipelineSoftware:
		return swDesc(camera, flip)
	default:
		return ""
	}
}

func hwDesc(depay string, parse string, camera CameraConfig, flip int) string {
	return fmt.Sprintf(
		`rtspsrc location="%s" latency=%d protocols=%s ! `+
			`%s ! %s ! nvv4l2decoder ! `+
			`nvvidconv flip-method=%d ! `+
			`video/x-raw,width=%d,height=%d,format=I420 ! `+
			`nvjpegenc quality=%d ! %s`,
		camera.RTSPURL, camera.LatencyMS, camera.Protocols,
		depay, parse,
		flip,
		camera.Width, camera.Height,
		camera.JPEGQuality, sinkCaps,
	)
}

func swDesc(camera CameraConfig, flip int) string {
	flipPart := ""
	if flip != 0 {
		flipPart = "! videoflip method=rotate-180 "
	}
	return fmt.Sprintf(
		`rtspsrc location="%s" latency=%d protocols=%s ! `+
			`decodebin %s! videoconvert ! videoscale ! `+
			`video/x-raw,width=%d,height=%d,format=I420 ! `+
			`jpegenc quality=%d ! %s`,
		camera.RTSPURL, camera.LatencyMS, camera.Protocols,
		flipPart,
		camera.Width, camera.Height,
		camera.JPEGQuality, sinkCaps,
	)
}
