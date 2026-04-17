package gstcodec

import "strings"

type VideoCodec string

const (
	VideoCodecH264 VideoCodec = "h264"
	VideoCodecH265 VideoCodec = "h265"
)

func NormalizeVideoCodec(value string) VideoCodec {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "h265", "hevc":
		return VideoCodecH265
	default:
		return VideoCodecH264
	}
}

func SupportedVideoCodecs() []string {
	return []string{string(VideoCodecH264), string(VideoCodecH265)}
}
