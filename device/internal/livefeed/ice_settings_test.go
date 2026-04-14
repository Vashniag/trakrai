package livefeed

import (
	"net/netip"
	"testing"
)

func TestInterfaceAllowedFiltersExcludedPrefixes(t *testing.T) {
	t.Parallel()

	excludedPrefixes := []string{"lo", "docker", "br-", "veth"}

	testCases := []struct {
		name          string
		interfaceName string
		want          bool
	}{
		{name: "ethernet", interfaceName: "eth0", want: true},
		{name: "wireguard", interfaceName: "wg0", want: true},
		{name: "loopback", interfaceName: "lo", want: false},
		{name: "docker bridge", interfaceName: "docker0", want: false},
		{name: "custom bridge", interfaceName: "br-98b7fd", want: false},
		{name: "veth pair", interfaceName: "veth1234", want: false},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			if got := interfaceAllowed(testCase.interfaceName, excludedPrefixes); got != testCase.want {
				t.Fatalf("interfaceAllowed(%q) = %v, want %v", testCase.interfaceName, got, testCase.want)
			}
		})
	}
}

func TestAllowIPv4CandidateIP(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		address string
		want    bool
	}{
		{name: "private v4", address: "10.8.0.50", want: true},
		{name: "public v4", address: "49.207.53.227", want: true},
		{name: "loopback", address: "127.0.0.1", want: false},
		{name: "ipv6 global", address: "2406:7400:50:6fa:7ac8:4e5:881e:106b", want: false},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			address := netip.MustParseAddr(testCase.address)
			if got := allowIPv4CandidateIP(address.AsSlice()); got != testCase.want {
				t.Fatalf("allowIPv4CandidateIP(%q) = %v, want %v", testCase.address, got, testCase.want)
			}
		})
	}
}
