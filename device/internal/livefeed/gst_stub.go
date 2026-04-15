//go:build !cgo

package livefeed

import "fmt"

func GstInit() {}

type Encoder struct{}
type PacketReader struct{}
type PipelineWriter struct{}
type MultiSourceEncoder struct{}

func NewEncoder(_ string) (*Encoder, error) {
	return nil, fmt.Errorf("gstreamer encoder is unavailable without cgo")
}

func (e *Encoder) Start() error {
	if e == nil {
		return fmt.Errorf("encoder is not initialized")
	}

	return nil
}

func (e *Encoder) PushFrame(_ []byte, _ uint64) error {
	if e == nil {
		return fmt.Errorf("encoder is not initialized")
	}

	return nil
}

func (e *Encoder) PullPacket(_ uint64) ([]byte, error) {
	if e == nil {
		return nil, fmt.Errorf("encoder is not initialized")
	}

	return nil, nil
}

func (e *Encoder) Stop() {}

func NewPacketReader(_ string) (*PacketReader, error) {
	return nil, fmt.Errorf("gstreamer packet reader is unavailable without cgo")
}

func (r *PacketReader) Start() error {
	if r == nil {
		return fmt.Errorf("packet reader is not initialized")
	}

	return nil
}

func (r *PacketReader) PullPacket(_ uint64) ([]byte, error) {
	if r == nil {
		return nil, fmt.Errorf("packet reader is not initialized")
	}

	return nil, nil
}

func (r *PacketReader) Stop() {}

func NewPipelineWriter(_ string) (*PipelineWriter, error) {
	return nil, fmt.Errorf("gstreamer pipeline writer is unavailable without cgo")
}

func (w *PipelineWriter) Start() error {
	if w == nil {
		return fmt.Errorf("pipeline writer is not initialized")
	}

	return nil
}

func (w *PipelineWriter) PushFrame(_ []byte, _ uint64, _ uint64) error {
	if w == nil {
		return fmt.Errorf("pipeline writer is not initialized")
	}

	return nil
}

func (w *PipelineWriter) Finalize(_ uint64) error {
	if w == nil {
		return fmt.Errorf("pipeline writer is not initialized")
	}

	return nil
}

func (w *PipelineWriter) Stop() {}

func NewMultiSourceEncoder(_ string, _ int) (*MultiSourceEncoder, error) {
	return nil, fmt.Errorf("gstreamer encoder is unavailable without cgo")
}

func (e *MultiSourceEncoder) Start() error {
	if e == nil {
		return fmt.Errorf("encoder is not initialized")
	}

	return nil
}

func (e *MultiSourceEncoder) PushFrame(_ int, _ []byte, _ uint64) error {
	if e == nil {
		return fmt.Errorf("encoder is not initialized")
	}

	return nil
}

func (e *MultiSourceEncoder) PullPacket(_ uint64) ([]byte, error) {
	if e == nil {
		return nil, fmt.Errorf("encoder is not initialized")
	}

	return nil, nil
}

func (e *MultiSourceEncoder) Stop() {}
