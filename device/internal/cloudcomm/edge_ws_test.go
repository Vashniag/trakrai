package cloudcomm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/trakrai/device-services/internal/ipc"
)

func TestEdgeWebSocketServerDispatchesGenericPacket(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
		},
	}

	var dispatchedRoute topicRoute
	var dispatchedEnvelope ipc.MQTTEnvelope
	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			dispatchedRoute = route
			dispatchedEnvelope = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	serviceName := "ptz-control"
	server.handleWebSocketMessage(&edgeClient{}, edgeInboundFrame{
		Envelope: ipc.MQTTEnvelope{
			Payload: marshalPayload(map[string]interface{}{"cameraName": "Front Gate"}),
			Type:    "start-move",
		},
		Kind:     "packet",
		Service:  &serviceName,
		Subtopic: "command",
	})

	if dispatchedRoute.service != serviceName {
		t.Fatalf("expected service %q, got %q", serviceName, dispatchedRoute.service)
	}
	if dispatchedRoute.subtopic != "command" {
		t.Fatalf("expected command subtopic, got %q", dispatchedRoute.subtopic)
	}
	if dispatchedEnvelope.Type != "start-move" {
		t.Fatalf("expected envelope type start-move, got %q", dispatchedEnvelope.Type)
	}
}

func TestEdgeWebSocketServerBroadcastsGenericPackets(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
			WebRTC: EdgeWebRTCConfig{
				ICEServers: []EdgeICEServerConfig{
					{URLs: []string{"stun:stun.l.google.com:19302"}},
				},
			},
		},
	}

	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?deviceId=edge-device-1"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	_, _, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read session-info: %v", err)
	}
	_, _, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read initial device status: %v", err)
	}

	delivered := server.Broadcast("ptz-control", "response", buildEnvelope("ptz-command-ack", marshalPayload(map[string]interface{}{
		"cameraName": "Front Gate",
		"command":    "start-move",
	})))
	if delivered != 1 {
		t.Fatalf("expected 1 websocket delivery, got %d", delivered)
	}

	type outbound struct {
		Envelope ipc.MQTTEnvelope `json:"envelope"`
		Service  *string          `json:"service"`
		Subtopic string           `json:"subtopic"`
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	var message outbound
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read broadcast packet: %v", err)
	}

	if message.Service == nil || *message.Service != "ptz-control" {
		t.Fatalf("expected service ptz-control, got %#v", message.Service)
	}
	if message.Subtopic != "response" {
		t.Fatalf("expected response subtopic, got %q", message.Subtopic)
	}
	if message.Envelope.Type != "ptz-command-ack" {
		t.Fatalf("expected payload type ptz-command-ack, got %q", message.Envelope.Type)
	}
}

func TestEdgeWebSocketServerServesIceConfig(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
			WebRTC: EdgeWebRTCConfig{
				ICEServers: []EdgeICEServerConfig{
					{
						URLs: []string{"stun:stun.l.google.com:19302"},
					},
					{
						URLs:       []string{"turn:10.8.0.50:3478"},
						Username:   "trakrai",
						Credential: "secret",
					},
				},
			},
		},
	}

	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	req := httptest.NewRequest(http.MethodGet, "/api/ice-config", nil)
	recorder := httptest.NewRecorder()

	server.handleIceConfig(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", recorder.Code)
	}

	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected no-store Cache-Control header, got %q", recorder.Header().Get("Cache-Control"))
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected wildcard CORS header, got %q", recorder.Header().Get("Access-Control-Allow-Origin"))
	}

	var response struct {
		ICEServers []map[string]interface{} `json:"iceServers"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode ice-config response: %v", err)
	}

	if len(response.ICEServers) != 2 {
		t.Fatalf("expected 2 ICE servers, got %d", len(response.ICEServers))
	}
	if urls, ok := response.ICEServers[0]["urls"].(string); !ok || urls != "stun:stun.l.google.com:19302" {
		t.Fatalf("expected STUN urls to serialize as a string, got %#v", response.ICEServers[0]["urls"])
	}
	if _, exists := response.ICEServers[0]["username"]; exists {
		t.Fatalf("expected STUN server to omit empty username")
	}
	if username, ok := response.ICEServers[1]["username"].(string); !ok || username != "trakrai" {
		t.Fatalf("expected TURN username to round-trip, got %#v", response.ICEServers[1]["username"])
	}
}

func TestEdgeWebSocketServerServesRuntimeConfig(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
			UI: EdgeUIConfig{
				DiagnosticsEnabled: true,
				ManagementService:  "runtime-manager",
				TransportMode:      "edge",
			},
		},
	}

	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	req := httptest.NewRequest(http.MethodGet, "/api/runtime-config", nil)
	req.Host = "edge.local:8080"
	recorder := httptest.NewRecorder()

	server.handleRuntimeConfig(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", recorder.Code)
	}

	var response struct {
		CloudBridgeURL     string `json:"cloudBridgeUrl"`
		DeviceID           string `json:"deviceId"`
		DiagnosticsEnabled bool   `json:"diagnosticsEnabled"`
		EdgeBridgeURL      string `json:"edgeBridgeUrl"`
		ManagementService  string `json:"managementService"`
		TransportMode      string `json:"transportMode"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode runtime-config response: %v", err)
	}

	if response.DeviceID != cfg.DeviceID {
		t.Fatalf("expected device ID %q, got %q", cfg.DeviceID, response.DeviceID)
	}
	if response.EdgeBridgeURL != "http://edge.local:8080" {
		t.Fatalf("expected edge bridge URL to use request host, got %q", response.EdgeBridgeURL)
	}
	if response.ManagementService != "runtime-manager" {
		t.Fatalf("expected runtime-manager management service, got %q", response.ManagementService)
	}
	if response.TransportMode != "edge" {
		t.Fatalf("expected edge transport mode, got %q", response.TransportMode)
	}
}

func TestEdgeWebSocketServerServesStaticUIBundle(t *testing.T) {
	t.Parallel()

	staticDir := t.TempDir()
	indexPath := filepath.Join(staticDir, "index.html")
	appPath := filepath.Join(staticDir, "_next", "static", "app.js")

	if err := os.MkdirAll(filepath.Dir(appPath), 0o755); err != nil {
		t.Fatalf("create asset directories failed: %v", err)
	}
	if err := os.WriteFile(indexPath, []byte("<html><body>trakrai edge</body></html>"), 0o644); err != nil {
		t.Fatalf("write index failed: %v", err)
	}
	if err := os.WriteFile(appPath, []byte("console.log('trakrai')"), 0o644); err != nil {
		t.Fatalf("write app asset failed: %v", err)
	}

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
			UI: EdgeUIConfig{
				Enabled:   true,
				StaticDir: staticDir,
			},
		},
	}

	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	indexResp, err := http.Get(httpServer.URL + "/")
	if err != nil {
		t.Fatalf("fetch index failed: %v", err)
	}
	defer indexResp.Body.Close()

	if indexResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for index, got %d", indexResp.StatusCode)
	}

	nestedResp, err := http.Get(httpServer.URL + "/runtime")
	if err != nil {
		t.Fatalf("fetch nested route failed: %v", err)
	}
	defer nestedResp.Body.Close()

	if nestedResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for nested route fallback, got %d", nestedResp.StatusCode)
	}

	assetResp, err := http.Get(httpServer.URL + "/_next/static/app.js")
	if err != nil {
		t.Fatalf("fetch asset failed: %v", err)
	}
	defer assetResp.Body.Close()

	if assetResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for asset, got %d", assetResp.StatusCode)
	}
}

func TestEdgeWebSocketServerRoutesSessionPacketsToOwningClient(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
		},
	}

	routeEvents := make(chan struct {
		env   ipc.MQTTEnvelope
		route topicRoute
	}, 1)
	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			routeEvents <- struct {
				env   ipc.MQTTEnvelope
				route topicRoute
			}{
				env:   env,
				route: route,
			}
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?deviceId=edge-device-1"
	firstConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial first websocket failed: %v", err)
	}
	defer firstConn.Close()

	secondConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial second websocket failed: %v", err)
	}
	defer secondConn.Close()

	drainInitialMessages := func(conn *websocket.Conn) {
		t.Helper()
		for i := 0; i < 2; i++ {
			if _, _, err := conn.ReadMessage(); err != nil {
				t.Fatalf("failed to read initial websocket message: %v", err)
			}
		}
	}

	drainInitialMessages(firstConn)
	drainInitialMessages(secondConn)

	requestID := "req-1"
	if err := firstConn.WriteJSON(map[string]interface{}{
		"envelope": map[string]interface{}{
			"payload": map[string]interface{}{
				"cameraName": "LP1-Main",
				"requestId":  requestID,
			},
			"type": "start-live",
		},
		"kind":     "packet",
		"service":  "live-feed",
		"subtopic": "command",
	}); err != nil {
		t.Fatalf("failed to send start-live packet: %v", err)
	}

	var dispatched struct {
		env   ipc.MQTTEnvelope
		route topicRoute
	}
	select {
	case dispatched = <-routeEvents:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for dispatched packet")
	}

	if dispatched.route.service != "live-feed" || dispatched.route.subtopic != "command" {
		t.Fatalf("unexpected route %#v", dispatched.route)
	}

	server.Broadcast("live-feed", "response", buildEnvelope("start-live-ack", marshalPayload(map[string]interface{}{
		"cameraName": "LP1-Main",
		"ok":         true,
		"requestId":  requestID,
		"sessionId":  "session-1",
	})))
	server.Broadcast("live-feed", "webrtc/offer", buildEnvelope("sdp-offer", marshalPayload(map[string]interface{}{
		"cameraName": "LP1-Main",
		"requestId":  requestID,
		"sdp":        "offer",
		"sessionId":  "session-1",
	})))

	type outbound struct {
		Envelope ipc.MQTTEnvelope `json:"envelope"`
		Service  *string          `json:"service"`
		Subtopic string           `json:"subtopic"`
	}

	_ = firstConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var firstAck outbound
	if err := firstConn.ReadJSON(&firstAck); err != nil {
		t.Fatalf("failed to read first live response: %v", err)
	}
	if firstAck.Subtopic != "response" {
		t.Fatalf("expected response subtopic for owner, got %q", firstAck.Subtopic)
	}

	var firstOffer outbound
	if err := firstConn.ReadJSON(&firstOffer); err != nil {
		t.Fatalf("failed to read first sdp-offer packet: %v", err)
	}
	if firstOffer.Subtopic != "webrtc/offer" {
		t.Fatalf("expected webrtc/offer for owner, got %q", firstOffer.Subtopic)
	}

	_ = secondConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if _, _, err := secondConn.ReadMessage(); err == nil {
		t.Fatalf("expected non-owner websocket to receive no session-scoped packets")
	}
}

func TestEdgeWebSocketServerStopsOwnedLiveSessionWhenOwnerDisconnects(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
		},
	}

	routeEvents := make(chan struct {
		env   ipc.MQTTEnvelope
		route topicRoute
	}, 2)
	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			routeEvents <- struct {
				env   ipc.MQTTEnvelope
				route topicRoute
			}{
				env:   env,
				route: route,
			}
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?deviceId=edge-device-1"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket failed: %v", err)
	}
	defer conn.Close()

	for i := 0; i < 2; i++ {
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("failed to read initial websocket message: %v", err)
		}
	}

	requestID := "req-1"
	if err := conn.WriteJSON(map[string]interface{}{
		"envelope": map[string]interface{}{
			"payload": map[string]interface{}{
				"cameraName": "LP1-Main",
				"requestId":  requestID,
			},
			"type": "start-live",
		},
		"kind":     "packet",
		"service":  "live-feed",
		"subtopic": "command",
	}); err != nil {
		t.Fatalf("failed to send start-live packet: %v", err)
	}

	select {
	case <-routeEvents:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for start-live dispatch")
	}

	server.Broadcast("live-feed", "response", buildEnvelope("start-live-ack", marshalPayload(map[string]interface{}{
		"cameraName": "LP1-Main",
		"ok":         true,
		"requestId":  requestID,
		"sessionId":  "session-1",
	})))

	type outbound struct {
		Envelope ipc.MQTTEnvelope `json:"envelope"`
		Service  *string          `json:"service"`
		Subtopic string           `json:"subtopic"`
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var ack outbound
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("failed to read start-live-ack packet: %v", err)
	}

	if err := conn.Close(); err != nil {
		t.Fatalf("failed to close websocket client: %v", err)
	}

	var dispatched struct {
		env   ipc.MQTTEnvelope
		route topicRoute
	}
	select {
	case dispatched = <-routeEvents:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for disconnect stop-live dispatch")
	}

	if dispatched.route.service != "live-feed" || dispatched.route.subtopic != "command" {
		t.Fatalf("unexpected route %#v", dispatched.route)
	}
	if dispatched.env.Type != "stop-live" {
		t.Fatalf("expected stop-live envelope, got %q", dispatched.env.Type)
	}

	var payload struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(dispatched.env.Payload, &payload); err != nil {
		t.Fatalf("failed to decode stop-live payload: %v", err)
	}
	if payload.SessionID != "session-1" {
		t.Fatalf("expected session-1 in stop-live payload, got %q", payload.SessionID)
	}
}

func TestEdgeWebSocketServerDoesNotBroadcastBrowserOriginIce(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
		},
	}

	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?deviceId=edge-device-1"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket failed: %v", err)
	}
	defer conn.Close()

	for i := 0; i < 2; i++ {
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("failed to read initial websocket message: %v", err)
		}
	}

	delivered := server.Broadcast("live-feed", "webrtc/ice", buildEnvelope("ice-candidate", marshalPayload(map[string]interface{}{
		"candidate": map[string]interface{}{"candidate": "candidate:1"},
		"origin":    "browser",
		"sessionId": "session-1",
	})))
	if delivered != 0 {
		t.Fatalf("expected browser-origin ICE to be suppressed, got %d deliveries", delivered)
	}

	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatalf("expected no websocket message for suppressed browser-origin ICE")
	}
}

func TestEdgeWebSocketServerClosesFloodingClient(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
			RateLimit: EdgeRateLimitConfig{
				MaxCommandMessages: 2,
				MaxMessages:        10,
				WindowSec:          1,
			},
		},
	}

	var dispatchedCount atomic.Int32
	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			_ = route
			_ = env
			dispatchedCount.Add(1)
			return nil
		},
		func() ipc.MQTTEnvelope {
			return buildEnvelope("status", marshalPayload(map[string]interface{}{"deviceId": cfg.DeviceID}))
		},
	)

	httpServer := httptest.NewServer(httpTestMux(server))
	defer httpServer.Close()

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?deviceId=edge-device-1"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket failed: %v", err)
	}
	defer conn.Close()

	for i := 0; i < 2; i++ {
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("failed to read initial websocket message: %v", err)
		}
	}

	packet := map[string]interface{}{
		"envelope": map[string]interface{}{
			"payload": map[string]interface{}{
				"requestId": "req-1",
			},
			"type": "get-status",
		},
		"kind":     "packet",
		"service":  "runtime-manager",
		"subtopic": "command",
	}

	for i := 0; i < 3; i++ {
		if err := conn.WriteJSON(packet); err != nil && i < 2 {
			t.Fatalf("failed to write websocket packet %d: %v", i+1, err)
		}
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("expected websocket connection to close after rate limit violation")
	} else {
		closeErr, ok := err.(*websocket.CloseError)
		if !ok {
			t.Fatalf("expected close error, got %T: %v", err, err)
		}
		if closeErr.Code != websocket.ClosePolicyViolation {
			t.Fatalf("expected policy violation close code, got %d", closeErr.Code)
		}
	}

	if dispatchedCount.Load() != 2 {
		t.Fatalf("expected only 2 dispatched packets before close, got %d", dispatchedCount.Load())
	}
}

func httpTestMux(server *EdgeWebSocketServer) *http.ServeMux {
	mux := http.NewServeMux()
	server.registerRoutes(mux)
	return mux
}
