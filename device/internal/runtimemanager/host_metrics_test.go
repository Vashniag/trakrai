package runtimemanager

import (
	"math"
	"testing"
)

func TestParseProcLoadData(t *testing.T) {
	t.Parallel()

	load, err := parseProcLoadData("1.25 0.75 0.50 1/234 5678\n")
	if err != nil {
		t.Fatalf("parse proc load failed: %v", err)
	}

	if load.OneMinute == nil || *load.OneMinute != 1.25 {
		t.Fatalf("expected one minute load 1.25, got %#v", load.OneMinute)
	}
	if load.FiveMinute == nil || *load.FiveMinute != 0.75 {
		t.Fatalf("expected five minute load 0.75, got %#v", load.FiveMinute)
	}
	if load.FifteenMinute == nil || *load.FifteenMinute != 0.50 {
		t.Fatalf("expected fifteen minute load 0.50, got %#v", load.FifteenMinute)
	}
}

func TestParseProcMemoryData(t *testing.T) {
	t.Parallel()

	stats, err := parseProcMemoryData(`
MemTotal:        4096000 kB
MemFree:         1024000 kB
MemAvailable:    2048000 kB
Buffers:          128000 kB
Cached:           256000 kB
SwapTotal:       1024000 kB
SwapFree:         512000 kB
`)
	if err != nil {
		t.Fatalf("parse proc memory failed: %v", err)
	}

	if stats.TotalBytes != 4096000*1024 {
		t.Fatalf("unexpected total bytes %d", stats.TotalBytes)
	}
	if stats.AvailableBytes != 2048000*1024 {
		t.Fatalf("unexpected available bytes %d", stats.AvailableBytes)
	}
	if stats.UsedBytes != 2048000*1024 {
		t.Fatalf("unexpected used bytes %d", stats.UsedBytes)
	}
	if stats.SwapUsedBytes != 512000*1024 {
		t.Fatalf("unexpected swap used bytes %d", stats.SwapUsedBytes)
	}
	if stats.UsedPercent == nil || math.Abs(*stats.UsedPercent-50) > 0.001 {
		t.Fatalf("unexpected memory percent %#v", stats.UsedPercent)
	}
}

func TestParseProcCPUStatData(t *testing.T) {
	t.Parallel()

	sample, err := parseProcCPUStatData("cpu  100 20 30 400 50 0 0 0 0 0\ncpu0 10 0 0 0 0 0 0 0 0 0\n")
	if err != nil {
		t.Fatalf("parse proc cpu stat failed: %v", err)
	}

	if sample.total != 600 {
		t.Fatalf("expected total 600, got %d", sample.total)
	}
	if sample.idle != 450 {
		t.Fatalf("expected idle 450, got %d", sample.idle)
	}
}

func TestParseProcNetDevData(t *testing.T) {
	t.Parallel()

	snapshot, err := parseProcNetDevData(`
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
  eth0: 4000 40 0 0 0 0 0 0 8000 80 0 0 0 0 0 0
`)
	if err != nil {
		t.Fatalf("parse proc net dev failed: %v", err)
	}

	if snapshot.aggregate.rxBytes != 5000 {
		t.Fatalf("expected aggregate rx 5000, got %d", snapshot.aggregate.rxBytes)
	}
	if snapshot.aggregate.txBytes != 10000 {
		t.Fatalf("expected aggregate tx 10000, got %d", snapshot.aggregate.txBytes)
	}
	if snapshot.perIFace["eth0"].rxBytes != 4000 {
		t.Fatalf("expected eth0 rx 4000, got %d", snapshot.perIFace["eth0"].rxBytes)
	}
	if snapshot.perIFace["lo"].txBytes != 2000 {
		t.Fatalf("expected lo tx 2000, got %d", snapshot.perIFace["lo"].txBytes)
	}
}

func TestParseTegrastatsLine(t *testing.T) {
	t.Parallel()

	stats := parseTegrastatsLine(
		`RAM 512/3956MB (lfb 64x4MB) SWAP 0/1978MB CPU [5%@345,off,off,off] GR3D_FREQ 37%@230 GPU@41C NVENC 15%@230 NVDEC 5%@230`,
	)
	if stats == nil {
		t.Fatalf("expected tegrastats metrics")
	}
	if stats.UtilizationPercent == nil || *stats.UtilizationPercent != 37 {
		t.Fatalf("unexpected gpu utilization %#v", stats.UtilizationPercent)
	}
	if stats.EncoderUtilizationPercent == nil || *stats.EncoderUtilizationPercent != 15 {
		t.Fatalf("unexpected nvenc utilization %#v", stats.EncoderUtilizationPercent)
	}
	if stats.DecoderUtilizationPercent == nil || *stats.DecoderUtilizationPercent != 5 {
		t.Fatalf("unexpected nvdec utilization %#v", stats.DecoderUtilizationPercent)
	}
	if stats.TemperatureCelsius == nil || *stats.TemperatureCelsius != 41 {
		t.Fatalf("unexpected gpu temperature %#v", stats.TemperatureCelsius)
	}
}
