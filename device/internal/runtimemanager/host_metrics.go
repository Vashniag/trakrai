package runtimemanager

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type RuntimeSystemSnapshot struct {
	CollectedAt   string              `json:"collectedAt"`
	CPU           RuntimeCPUStats     `json:"cpu"`
	Disks         []RuntimeDiskStats  `json:"disks,omitempty"`
	GPU           *RuntimeGPUStats    `json:"gpu,omitempty"`
	Load          RuntimeLoadStats    `json:"load"`
	Memory        RuntimeMemoryStats  `json:"memory"`
	Network       RuntimeNetworkStats `json:"network"`
	UptimeSeconds *float64            `json:"uptimeSeconds,omitempty"`
}

type RuntimeCPUStats struct {
	CoreCount    int      `json:"coreCount"`
	UsagePercent *float64 `json:"usagePercent,omitempty"`
}

type RuntimeLoadStats struct {
	FifteenMinute *float64 `json:"fifteenMinute,omitempty"`
	FiveMinute    *float64 `json:"fiveMinute,omitempty"`
	OneMinute     *float64 `json:"oneMinute,omitempty"`
}

type RuntimeMemoryStats struct {
	AvailableBytes uint64   `json:"availableBytes,omitempty"`
	SwapTotalBytes uint64   `json:"swapTotalBytes,omitempty"`
	SwapUsedBytes  uint64   `json:"swapUsedBytes,omitempty"`
	TotalBytes     uint64   `json:"totalBytes,omitempty"`
	UsedBytes      uint64   `json:"usedBytes,omitempty"`
	UsedPercent    *float64 `json:"usedPercent,omitempty"`
}

type RuntimeDiskStats struct {
	FreeBytes   uint64   `json:"freeBytes,omitempty"`
	Label       string   `json:"label"`
	Path        string   `json:"path"`
	TotalBytes  uint64   `json:"totalBytes,omitempty"`
	UsedBytes   uint64   `json:"usedBytes,omitempty"`
	UsedPercent *float64 `json:"usedPercent,omitempty"`
}

type RuntimeNetworkStats struct {
	Interfaces       []RuntimeNetworkInterfaceStats `json:"interfaces,omitempty"`
	RxBytes          uint64                         `json:"rxBytes,omitempty"`
	RxBytesPerSecond *float64                       `json:"rxBytesPerSecond,omitempty"`
	TxBytes          uint64                         `json:"txBytes,omitempty"`
	TxBytesPerSecond *float64                       `json:"txBytesPerSecond,omitempty"`
}

type RuntimeNetworkInterfaceStats struct {
	Name             string   `json:"name"`
	RxBytes          uint64   `json:"rxBytes,omitempty"`
	RxBytesPerSecond *float64 `json:"rxBytesPerSecond,omitempty"`
	TxBytes          uint64   `json:"txBytes,omitempty"`
	TxBytesPerSecond *float64 `json:"txBytesPerSecond,omitempty"`
}

type RuntimeGPUStats struct {
	DecoderUtilizationPercent *float64 `json:"decoderUtilizationPercent,omitempty"`
	EncoderUtilizationPercent *float64 `json:"encoderUtilizationPercent,omitempty"`
	MemoryTotalBytes          uint64   `json:"memoryTotalBytes,omitempty"`
	MemoryUsedBytes           uint64   `json:"memoryUsedBytes,omitempty"`
	Source                    string   `json:"source"`
	TemperatureCelsius        *float64 `json:"temperatureCelsius,omitempty"`
	UtilizationPercent        *float64 `json:"utilizationPercent,omitempty"`
}

type systemMetricsCollector interface {
	Collect(ctx context.Context) RuntimeSystemSnapshot
}

type hostMetricsCollector struct {
	cfg *Config
	now func() time.Time

	mu             sync.Mutex
	previousCPU    *cpuCounterSample
	previousNet    *networkCounterSample
	tegrastatsPath string
}

type cpuCounterSample struct {
	idle  uint64
	total uint64
}

type networkCounter struct {
	rxBytes uint64
	txBytes uint64
}

type networkCounterSample struct {
	at        time.Time
	aggregate networkCounter
	perIFace  map[string]networkCounter
}

func newHostMetricsCollector(cfg *Config, now func() time.Time) systemMetricsCollector {
	tegrastatsPath, err := exec.LookPath("tegrastats")
	if err != nil {
		tegrastatsPath = ""
	}

	return &hostMetricsCollector{
		cfg:            cfg,
		now:            now,
		tegrastatsPath: tegrastatsPath,
	}
}

func (c *hostMetricsCollector) Collect(ctx context.Context) RuntimeSystemSnapshot {
	snapshot := RuntimeSystemSnapshot{
		CollectedAt: c.now().UTC().Format(time.RFC3339Nano),
		CPU: RuntimeCPUStats{
			CoreCount: runtime.NumCPU(),
		},
	}

	if uptime, err := readProcUptime(); err == nil {
		snapshot.UptimeSeconds = pointerFloat64(uptime)
	}

	if load, err := readProcLoad(); err == nil {
		snapshot.Load = load
	}

	if memory, err := readProcMemory(); err == nil {
		snapshot.Memory = memory
	}

	if cpuPercent, err := c.readCPUUsage(); err == nil && cpuPercent != nil {
		snapshot.CPU.UsagePercent = cpuPercent
	}

	snapshot.Disks = c.readDiskUsage()
	snapshot.Network = c.readNetworkUsage()
	if gpu := c.readGPUStats(ctx); gpu != nil {
		snapshot.GPU = gpu
	}

	return snapshot
}

func (c *hostMetricsCollector) readCPUUsage() (*float64, error) {
	current, err := readCPUCounterSample()
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	previous := c.previousCPU
	c.previousCPU = current
	if previous == nil {
		return nil, nil
	}

	totalDelta := current.total - previous.total
	idleDelta := current.idle - previous.idle
	if totalDelta == 0 || idleDelta > totalDelta {
		return nil, nil
	}

	usagePercent := (float64(totalDelta-idleDelta) / float64(totalDelta)) * 100
	return &usagePercent, nil
}

func (c *hostMetricsCollector) readDiskUsage() []RuntimeDiskStats {
	type diskTarget struct {
		label string
		path  string
	}

	targets := []diskTarget{
		{label: "Runtime root", path: c.cfg.Runtime.RootDir},
		{label: "Shared volume", path: c.cfg.Runtime.SharedDir},
		{label: "System root", path: "/"},
	}

	seen := make(map[string]struct{}, len(targets))
	disks := make([]RuntimeDiskStats, 0, len(targets))
	for _, target := range targets {
		path := strings.TrimSpace(target.path)
		if path == "" {
			continue
		}
		cleanPath := filepath.Clean(path)
		if _, exists := seen[cleanPath]; exists {
			continue
		}
		seen[cleanPath] = struct{}{}

		disk, err := readDiskStats(target.label, cleanPath)
		if err != nil {
			continue
		}
		disks = append(disks, disk)
	}

	return disks
}

func (c *hostMetricsCollector) readNetworkUsage() RuntimeNetworkStats {
	current, err := readNetworkCounters()
	if err != nil {
		return RuntimeNetworkStats{}
	}

	interfaces := make([]RuntimeNetworkInterfaceStats, 0, len(current.perIFace))
	for name, counters := range current.perIFace {
		interfaces = append(interfaces, RuntimeNetworkInterfaceStats{
			Name:    name,
			RxBytes: counters.rxBytes,
			TxBytes: counters.txBytes,
		})
	}
	sort.Slice(interfaces, func(left int, right int) bool {
		return interfaces[left].Name < interfaces[right].Name
	})

	stats := RuntimeNetworkStats{
		Interfaces: interfaces,
		RxBytes:    current.aggregate.rxBytes,
		TxBytes:    current.aggregate.txBytes,
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	previous := c.previousNet
	c.previousNet = current
	if previous == nil {
		return stats
	}

	elapsedSeconds := current.at.Sub(previous.at).Seconds()
	if elapsedSeconds <= 0 {
		return stats
	}

	if current.aggregate.rxBytes >= previous.aggregate.rxBytes {
		rxRate := float64(current.aggregate.rxBytes-previous.aggregate.rxBytes) / elapsedSeconds
		stats.RxBytesPerSecond = &rxRate
	}
	if current.aggregate.txBytes >= previous.aggregate.txBytes {
		txRate := float64(current.aggregate.txBytes-previous.aggregate.txBytes) / elapsedSeconds
		stats.TxBytesPerSecond = &txRate
	}

	for index := range stats.Interfaces {
		if previousCounters, exists := previous.perIFace[stats.Interfaces[index].Name]; exists {
			if stats.Interfaces[index].RxBytes >= previousCounters.rxBytes {
				rxRate := float64(stats.Interfaces[index].RxBytes-previousCounters.rxBytes) / elapsedSeconds
				stats.Interfaces[index].RxBytesPerSecond = &rxRate
			}
			if stats.Interfaces[index].TxBytes >= previousCounters.txBytes {
				txRate := float64(stats.Interfaces[index].TxBytes-previousCounters.txBytes) / elapsedSeconds
				stats.Interfaces[index].TxBytesPerSecond = &txRate
			}
		}
	}

	return stats
}

func (c *hostMetricsCollector) readGPUStats(ctx context.Context) *RuntimeGPUStats {
	if strings.TrimSpace(c.tegrastatsPath) == "" {
		return nil
	}

	line, err := readTegrastatsLine(ctx, c.tegrastatsPath)
	if err != nil {
		return nil
	}

	return parseTegrastatsLine(line)
}

func readProcUptime() (float64, error) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}

	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0, fmt.Errorf("proc uptime did not include any fields")
	}

	return strconv.ParseFloat(fields[0], 64)
}

func readProcLoad() (RuntimeLoadStats, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return RuntimeLoadStats{}, err
	}

	return parseProcLoadData(string(data))
}

func readProcMemory() (RuntimeMemoryStats, error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return RuntimeMemoryStats{}, err
	}

	return parseProcMemoryData(string(data))
}

func readCPUCounterSample() (*cpuCounterSample, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil, err
	}

	return parseProcCPUStatData(string(data))
}

func readDiskStats(label string, path string) (RuntimeDiskStats, error) {
	var filesystem syscall.Statfs_t
	if err := syscall.Statfs(path, &filesystem); err != nil {
		return RuntimeDiskStats{}, err
	}

	totalBytes := filesystem.Blocks * uint64(filesystem.Bsize)
	freeBytes := filesystem.Bavail * uint64(filesystem.Bsize)
	usedBytes := uint64(0)
	if totalBytes >= freeBytes {
		usedBytes = totalBytes - freeBytes
	}

	stats := RuntimeDiskStats{
		FreeBytes:  freeBytes,
		Label:      label,
		Path:       path,
		TotalBytes: totalBytes,
		UsedBytes:  usedBytes,
	}
	if totalBytes > 0 {
		usedPercent := (float64(usedBytes) / float64(totalBytes)) * 100
		stats.UsedPercent = &usedPercent
	}

	return stats, nil
}

func readNetworkCounters() (*networkCounterSample, error) {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil, err
	}

	return parseProcNetDevData(string(data))
}

func parseProcLoadData(data string) (RuntimeLoadStats, error) {
	fields := strings.Fields(data)
	if len(fields) < 3 {
		return RuntimeLoadStats{}, fmt.Errorf("proc loadavg returned %d fields", len(fields))
	}

	load := RuntimeLoadStats{}
	if value, err := strconv.ParseFloat(fields[0], 64); err == nil {
		load.OneMinute = &value
	}
	if value, err := strconv.ParseFloat(fields[1], 64); err == nil {
		load.FiveMinute = &value
	}
	if value, err := strconv.ParseFloat(fields[2], 64); err == nil {
		load.FifteenMinute = &value
	}

	return load, nil
}

func parseProcMemoryData(data string) (RuntimeMemoryStats, error) {
	values := make(map[string]uint64)
	for _, line := range strings.Split(data, "\n") {
		key, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}

		fields := strings.Fields(strings.TrimSpace(rest))
		if len(fields) == 0 {
			continue
		}

		valueKB, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}

		values[key] = valueKB * 1024
	}

	totalBytes := values["MemTotal"]
	availableBytes := values["MemAvailable"]
	if availableBytes == 0 {
		availableBytes = values["MemFree"] + values["Buffers"] + values["Cached"]
	}

	usedBytes := uint64(0)
	if totalBytes >= availableBytes {
		usedBytes = totalBytes - availableBytes
	}

	swapTotal := values["SwapTotal"]
	swapFree := values["SwapFree"]
	swapUsed := uint64(0)
	if swapTotal >= swapFree {
		swapUsed = swapTotal - swapFree
	}

	stats := RuntimeMemoryStats{
		AvailableBytes: availableBytes,
		SwapTotalBytes: swapTotal,
		SwapUsedBytes:  swapUsed,
		TotalBytes:     totalBytes,
		UsedBytes:      usedBytes,
	}
	if totalBytes > 0 {
		usedPercent := (float64(usedBytes) / float64(totalBytes)) * 100
		stats.UsedPercent = &usedPercent
	}

	return stats, nil
}

func parseProcCPUStatData(data string) (*cpuCounterSample, error) {
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 5 {
			return nil, fmt.Errorf("proc stat cpu line is incomplete")
		}

		counters := make([]uint64, 0, len(fields)-1)
		for _, value := range fields[1:] {
			counter, err := strconv.ParseUint(value, 10, 64)
			if err != nil {
				return nil, err
			}
			counters = append(counters, counter)
		}

		total := uint64(0)
		for _, counter := range counters {
			total += counter
		}

		idle := counters[3]
		if len(counters) > 4 {
			idle += counters[4]
		}

		return &cpuCounterSample{
			idle:  idle,
			total: total,
		}, nil
	}

	return nil, fmt.Errorf("proc stat does not include aggregate cpu counters")
}

func parseProcNetDevData(data string) (*networkCounterSample, error) {

	snapshot := &networkCounterSample{
		at:       time.Now(),
		perIFace: make(map[string]networkCounter),
	}

	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Inter-|") || strings.HasPrefix(line, "face |") {
			continue
		}

		namePart, countersPart, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}

		name := strings.TrimSpace(namePart)
		fields := strings.Fields(strings.TrimSpace(countersPart))
		if len(fields) < 16 {
			continue
		}

		rxBytes, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		txBytes, err := strconv.ParseUint(fields[8], 10, 64)
		if err != nil {
			continue
		}

		counters := networkCounter{
			rxBytes: rxBytes,
			txBytes: txBytes,
		}
		snapshot.perIFace[name] = counters
		snapshot.aggregate.rxBytes += rxBytes
		snapshot.aggregate.txBytes += txBytes
	}

	return snapshot, nil
}

func readTegrastatsLine(ctx context.Context, tegrastatsPath string) (string, error) {
	commandCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	reader, writer := io.Pipe()
	defer reader.Close()

	cmd := exec.CommandContext(commandCtx, tegrastatsPath, "--interval", "200")
	cmd.Stdout = writer
	cmd.Stderr = writer

	if err := cmd.Start(); err != nil {
		_ = writer.Close()
		return "", err
	}

	lineCh := make(chan string, 1)
	errCh := make(chan error, 1)
	go func() {
		defer close(lineCh)
		defer close(errCh)
		scanner := bufio.NewScanner(reader)
		if scanner.Scan() {
			lineCh <- strings.TrimSpace(scanner.Text())
			return
		}
		if err := scanner.Err(); err != nil {
			errCh <- err
			return
		}
		errCh <- fmt.Errorf("tegrastats did not produce any output")
	}()

	var line string
	select {
	case <-commandCtx.Done():
		_ = cmd.Process.Kill()
		_ = writer.Close()
		_ = cmd.Wait()
		return "", commandCtx.Err()
	case nextLine := <-lineCh:
		line = nextLine
	case err := <-errCh:
		_ = cmd.Process.Kill()
		_ = writer.Close()
		_ = cmd.Wait()
		return "", err
	}

	_ = cmd.Process.Kill()
	_ = writer.Close()
	_ = cmd.Wait()
	return line, nil
}

func parseTegrastatsLine(line string) *RuntimeGPUStats {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}

	stats := &RuntimeGPUStats{
		Source: "tegrastats",
	}

	if value := findPercentAfterToken(trimmed, "GR3D_FREQ"); value != nil {
		stats.UtilizationPercent = value
	}
	if value := findPercentAfterToken(trimmed, "NVENC"); value != nil {
		stats.EncoderUtilizationPercent = value
	}
	if value := findPercentAfterToken(trimmed, "NVDEC"); value != nil {
		stats.DecoderUtilizationPercent = value
	}
	if value := findTemperatureAfterToken(trimmed, "GPU"); value != nil {
		stats.TemperatureCelsius = value
	}

	if stats.UtilizationPercent == nil &&
		stats.EncoderUtilizationPercent == nil &&
		stats.DecoderUtilizationPercent == nil &&
		stats.TemperatureCelsius == nil {
		return nil
	}

	return stats
}

func findPercentAfterToken(input string, token string) *float64 {
	index := strings.Index(input, token)
	if index < 0 {
		return nil
	}

	segment := input[index+len(token):]
	for _, field := range strings.Fields(segment) {
		if percentIndex := strings.IndexRune(field, '%'); percentIndex > 0 {
			digits := strings.TrimLeft(field[:percentIndex], "@")
			digits = strings.TrimLeft(digits, "[")
			value, err := strconv.ParseFloat(strings.TrimSpace(digits), 64)
			if err == nil {
				return &value
			}
		}
		if strings.Contains(field, "C") {
			break
		}
	}

	return nil
}

func findTemperatureAfterToken(input string, token string) *float64 {
	index := strings.Index(input, token+"@")
	if index < 0 {
		return nil
	}

	segment := input[index+len(token)+1:]
	end := strings.IndexRune(segment, 'C')
	if end <= 0 {
		return nil
	}

	value, err := strconv.ParseFloat(strings.TrimSpace(segment[:end]), 64)
	if err != nil {
		return nil
	}
	return &value
}

func pointerFloat64(value float64) *float64 {
	return &value
}
