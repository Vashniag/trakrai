package cloudcomm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/trakrai/device-services/internal/ipc"
)

func TestTranslateWebSocketMessagePTZMove(t *testing.T) {
	t.Parallel()

	route, env, err := translateWebSocketMessage(edgeInboundMessage{
		Type:    "ptz-start-move",
		Payload: marshalPayload(map[string]interface{}{"cameraName": "Front Gate"}),
	})
	if err != nil {
		t.Fatalf("translateWebSocketMessage returned error: %v", err)
	}

	if route.service != ptzServiceName {
		t.Fatalf("expected service %q, got %q", ptzServiceName, route.service)
	}
	if route.subtopic != "command" {
		t.Fatalf("expected command subtopic, got %q", route.subtopic)
	}
	if env.Type != "start-move" {
		t.Fatalf("expected envelope type start-move, got %q", env.Type)
	}
}

func TestEdgeWebSocketServerBroadcastsLegacyMessageTypes(t *testing.T) {
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

	mux := httpTestMux(server)
	httpServer := httptest.NewServer(mux)
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
		t.Fatalf("failed to read initial device-status: %v", err)
	}

	delivered := server.Broadcast(ptzServiceName, "response", buildEnvelope("ptz-command-ack", marshalPayload(map[string]interface{}{
		"cameraName": "Front Gate",
		"command":    "start-move",
	})))
	if delivered != 1 {
		t.Fatalf("expected 1 websocket delivery, got %d", delivered)
	}

	type outbound struct {
		Type    string           `json:"type"`
		Service string           `json:"service"`
		Payload ipc.MQTTEnvelope `json:"payload"`
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	var message outbound
	if err := conn.ReadJSON(&message); err != nil {
		t.Fatalf("failed to read broadcast message: %v", err)
	}

	if message.Type != "ptz-response" {
		t.Fatalf("expected ptz-response, got %q", message.Type)
	}
	if message.Service != ptzServiceName {
		t.Fatalf("expected service %q, got %q", ptzServiceName, message.Service)
	}
	if message.Payload.Type != "ptz-command-ack" {
		t.Fatalf("expected payload type ptz-command-ack, got %q", message.Payload.Type)
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
	req.Header.Set("Origin", "http://localhost:3000")
	recorder := httptest.NewRecorder()

	server.handleIceConfig(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", recorder.Code)
	}

	if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("expected wildcard CORS header, got %q", recorder.Header().Get("Access-Control-Allow-Origin"))
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected no-store Cache-Control header, got %q", recorder.Header().Get("Cache-Control"))
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

func TestEdgeWebSocketServerRoutesLiveSessionToOwningClient(t *testing.T) {
	t.Parallel()

	cfg := &Config{
		DeviceID: "edge-device-1",
		Edge: EdgeWebSocketConfig{
			Enabled:    true,
			ListenAddr: ":0",
			Path:       "/ws",
		},
	}

	startLivePayloads := make(chan ipc.MQTTEnvelope, 1)
	server := NewEdgeWebSocketServer(
		cfg,
		func(route topicRoute, env ipc.MQTTEnvelope) error {
			if route.service == liveFeedServiceName && route.subtopic == "command" && env.Type == "start-live" {
				startLivePayloads <- env
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

	if err := firstConn.WriteJSON(map[string]interface{}{
		"type":    "start-live",
		"payload": map[string]interface{}{"cameraName": "LP1-Main"},
	}); err != nil {
		t.Fatalf("failed to send start-live: %v", err)
	}

	var dispatchedStartLive ipc.MQTTEnvelope
	select {
	case dispatchedStartLive = <-startLivePayloads:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for dispatched start-live command")
	}

	var dispatchedPayload struct {
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(dispatchedStartLive.Payload, &dispatchedPayload); err != nil {
		t.Fatalf("failed to decode dispatched start-live payload: %v", err)
	}
	if strings.TrimSpace(dispatchedPayload.RequestID) == "" {
		t.Fatal("expected generated requestId in dispatched start-live payload")
	}

	server.Broadcast(liveFeedServiceName, "response", buildEnvelope("start-live-ack", marshalPayload(map[string]interface{}{
		"cameraName": "LP1-Main",
		"ok":         true,
		"requestId":  dispatchedPayload.RequestID,
		"sessionId":  "session-1",
	})))
	server.Broadcast(liveFeedServiceName, "webrtc/offer", buildEnvelope("sdp-offer", marshalPayload(map[string]interface{}{
		"cameraName": "LP1-Main",
		"requestId":  dispatchedPayload.RequestID,
		"sdp":        "offer",
		"sessionId":  "session-1",
	})))

	type outbound struct {
		Type    string           `json:"type"`
		Payload ipc.MQTTEnvelope `json:"payload"`
	}

	_ = firstConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var firstAck outbound
	if err := firstConn.ReadJSON(&firstAck); err != nil {
		t.Fatalf("failed to read first live response: %v", err)
	}
	if firstAck.Type != "device-response" {
		t.Fatalf("expected device-response for owner, got %q", firstAck.Type)
	}

	var firstOffer outbound
	if err := firstConn.ReadJSON(&firstOffer); err != nil {
		t.Fatalf("failed to read first sdp-offer: %v", err)
	}
	if firstOffer.Type != "sdp-offer" {
		t.Fatalf("expected sdp-offer for owner, got %q", firstOffer.Type)
	}

	_ = secondConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if _, _, err := secondConn.ReadMessage(); err == nil {
		t.Fatalf("expected non-owner websocket to receive no live-session messages")
	}
}

func httpTestMux(server *EdgeWebSocketServer) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", server.handleHealth)
	mux.HandleFunc("/api/ice-config", server.handleIceConfig)
	mux.HandleFunc("/ws", server.handleWebSocket)
	return mux
}
