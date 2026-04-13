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

	var response struct {
		ICEServers []EdgeICEServerConfig `json:"iceServers"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode ice-config response: %v", err)
	}

	if len(response.ICEServers) != 2 {
		t.Fatalf("expected 2 ICE servers, got %d", len(response.ICEServers))
	}
	if response.ICEServers[1].Username != "trakrai" {
		t.Fatalf("expected TURN username to round-trip, got %q", response.ICEServers[1].Username)
	}
}

func httpTestMux(server *EdgeWebSocketServer) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", server.handleHealth)
	mux.HandleFunc("/api/ice-config", server.handleIceConfig)
	mux.HandleFunc("/ws", server.handleWebSocket)
	return mux
}
