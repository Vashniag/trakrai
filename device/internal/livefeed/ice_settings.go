package livefeed

import (
	"net"
	"strings"

	"github.com/pion/webrtc/v4"
)

func buildWebRTCAPI(cfg *Config) *webrtc.API {
	var settingEngine webrtc.SettingEngine

	settingEngine.SetIncludeLoopbackCandidate(false)
	if cfg.WebRTC.UDPPortRange.Min > 0 && cfg.WebRTC.UDPPortRange.Max > 0 {
		if err := settingEngine.SetEphemeralUDPPortRange(
			uint16(cfg.WebRTC.UDPPortRange.Min),
			uint16(cfg.WebRTC.UDPPortRange.Max),
		); err != nil {
			panic(err)
		}
	}
	if len(cfg.WebRTC.HostCandidateIPs) > 0 {
		settingEngine.SetNAT1To1IPs(cfg.WebRTC.HostCandidateIPs, webrtc.ICECandidateTypeHost)
	}
	settingEngine.SetInterfaceFilter(func(interfaceName string) bool {
		return interfaceAllowed(interfaceName, cfg.WebRTC.ExcludedInterfacePrefixes)
	})

	if cfg.WebRTC.ForceIPv4Candidates {
		settingEngine.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
		settingEngine.SetIPFilter(allowIPv4CandidateIP)
	} else {
		settingEngine.SetIPFilter(allowCandidateIP)
	}

	return webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))
}

func interfaceAllowed(interfaceName string, excludedPrefixes []string) bool {
	normalizedName := strings.ToLower(strings.TrimSpace(interfaceName))
	if normalizedName == "" {
		return false
	}

	for _, prefix := range excludedPrefixes {
		normalizedPrefix := strings.ToLower(strings.TrimSpace(prefix))
		if normalizedPrefix == "" {
			continue
		}
		if strings.HasPrefix(normalizedName, normalizedPrefix) {
			return false
		}
	}

	return true
}

func allowCandidateIP(ip net.IP) bool {
	if ip == nil {
		return false
	}

	if ip.IsLoopback() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}

	return true
}

func allowIPv4CandidateIP(ip net.IP) bool {
	if !allowCandidateIP(ip) {
		return false
	}

	return ip.To4() != nil
}
