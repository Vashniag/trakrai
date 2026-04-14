//go:build !cgo

package livefeed

import "fmt"

func GstInit() {}

type Encoder struct{}

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
