package livefeed

import (
	"net"
	"strings"

	"github.com/pion/webrtc/v4"
)

func buildWebRTCAPI(cfg *Config) *webrtc.API {
	var settingEngine webrtc.SettingEngine

	settingEngine.SetIncludeLoopbackCandidate(false)
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
