package livefeed

import (
	"fmt"
	"net"

	"github.com/trakrai/device-services/internal/generatedconfig"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const ServiceName = "live-feed"

type IPCConfig struct {
	SocketPath string `json:"socket_path"`
}

type TURNServer struct {
	URL        string `json:"url"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

type WebRTCConfig struct {
	AdvertiseRelayCandidates  bool         `json:"advertise_relay_candidates"`
	ExcludedInterfacePrefixes []string     `json:"excluded_interface_prefixes"`
	ForceIPv4Candidates       bool         `json:"force_ipv4_candidates"`
	HostCandidateIPs          []string     `json:"host_candidate_ips"`
	STUNServers               []string     `json:"stun_servers"`
	TURNServers               []TURNServer `json:"turn_servers"`
	FramerateFPS              int          `json:"framerate_fps"`
	UDPPortRange              UDPPortRange `json:"udp_port_range"`
}

type CompositeConfig struct {
	Height      int `json:"height"`
	TilePadding int `json:"tile_padding"`
	Width       int `json:"width"`
}

type UDPPortRange struct {
	Max int `json:"max"`
	Min int `json:"min"`
}

type Config struct {
	LogLevel  string             `json:"log_level"`
	Redis     redisconfig.Config `json:"redis"`
	IPC       IPCConfig          `json:"ipc"`
	WebRTC    WebRTCConfig       `json:"webrtc"`
	Composite CompositeConfig    `json:"composite"`
}

func LoadConfig(path string) (*Config, error) {
	raw, err := generatedconfig.LoadLiveFeedConfig(path)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		LogLevel: raw.LogLevel,
		Redis: redisconfig.Config{
			Host:      raw.Redis.Host,
			Port:      raw.Redis.Port,
			Password:  raw.Redis.Password,
			DB:        raw.Redis.Db,
			KeyPrefix: raw.Redis.KeyPrefix,
		},
		IPC: IPCConfig{
			SocketPath: raw.Ipc.SocketPath,
		},
		WebRTC: WebRTCConfig{
			AdvertiseRelayCandidates:  raw.Webrtc.AdvertiseRelayCandidates,
			ExcludedInterfacePrefixes: append([]string(nil), raw.Webrtc.ExcludedInterfacePrefixes...),
			ForceIPv4Candidates:       raw.Webrtc.ForceIpv4Candidates,
			HostCandidateIPs:          append([]string(nil), raw.Webrtc.HostCandidateIps...),
			STUNServers:               append([]string(nil), raw.Webrtc.StunServers...),
			FramerateFPS:              raw.Webrtc.FramerateFps,
			UDPPortRange: UDPPortRange{
				Min: raw.Webrtc.UdpPortRange.Min,
				Max: raw.Webrtc.UdpPortRange.Max,
			},
		},
		Composite: CompositeConfig{
			Width:       raw.Composite.Width,
			Height:      raw.Composite.Height,
			TilePadding: raw.Composite.TilePadding,
		},
	}
	for _, server := range raw.Webrtc.TurnServers {
		cfg.WebRTC.TURNServers = append(
			cfg.WebRTC.TURNServers,
			TURNServer{
				URL:        server.Url,
				Username:   server.Username,
				Credential: server.Credential,
			},
		)
	}

	cfg.Redis = redisconfig.WithDefaults(cfg.Redis, "camera")

	if cfg.IPC.SocketPath == "" {
		return nil, fmt.Errorf("ipc.socket_path is required")
	}
	if cfg.Composite.Width <= 0 {
		return nil, fmt.Errorf("composite.width must be greater than 0")
	}
	if cfg.Composite.Height <= 0 {
		return nil, fmt.Errorf("composite.height must be greater than 0")
	}
	if cfg.Composite.TilePadding < 0 {
		return nil, fmt.Errorf("composite.tile_padding must be zero or greater")
	}
	if cfg.WebRTC.UDPPortRange.Min != 0 || cfg.WebRTC.UDPPortRange.Max != 0 {
		if cfg.WebRTC.UDPPortRange.Min <= 0 || cfg.WebRTC.UDPPortRange.Max <= 0 {
			return nil, fmt.Errorf("webrtc.udp_port_range min/max must both be greater than 0.")
		}
		if cfg.WebRTC.UDPPortRange.Min > cfg.WebRTC.UDPPortRange.Max {
			return nil, fmt.Errorf("webrtc.udp_port_range min must be less than or equal to max")
		}
	}
	for _, hostCandidateIP := range cfg.WebRTC.HostCandidateIPs {
		if hostCandidateIP == "" {
			continue
		}
		if parsedIP := net.ParseIP(hostCandidateIP); parsedIP == nil {
			return nil, fmt.Errorf("invalid webrtc.host_candidate_ips entry %q", hostCandidateIP)
		}
	}

	return cfg, nil
}
