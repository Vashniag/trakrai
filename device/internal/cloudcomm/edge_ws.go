package cloudcomm

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/trakrai/device-services/internal/ipc"
)

const (
	defaultCommandSubtopic = "command"
	ptzServiceName         = "ptz-control"
	liveFeedServiceName    = "live-feed"
)

type edgeInboundMessage struct {
	Payload json.RawMessage `json:"payload"`
	Type    string          `json:"type"`
}

type edgePublishPayload struct {
	Payload  json.RawMessage `json:"payload"`
	Service  string          `json:"service"`
	Subtopic string          `json:"subtopic"`
	Type     string          `json:"type"`
}

type edgeSetDevicePayload struct {
	DeviceID string `json:"deviceId"`
}

type edgeOutboundMessage struct {
	DeviceID string           `json:"deviceId"`
	Payload  ipc.MQTTEnvelope `json:"payload"`
	Service  string           `json:"service,omitempty"`
	Subtopic string           `json:"subtopic,omitempty"`
	Type     string           `json:"type"`
}

type edgeClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *edgeClient) writeJSON(value interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.conn.WriteJSON(value)
}

type EdgeWebSocketServer struct {
	cfg *Config
	log *slog.Logger

	dispatch         func(route topicRoute, env ipc.MQTTEnvelope) error
	snapshotEnvelope func() ipc.MQTTEnvelope

	mu      sync.RWMutex
	clients map[*edgeClient]struct{}

	httpServer *http.Server
}

func NewEdgeWebSocketServer(
	cfg *Config,
	dispatch func(route topicRoute, env ipc.MQTTEnvelope) error,
	snapshotEnvelope func() ipc.MQTTEnvelope,
) *EdgeWebSocketServer {
	return &EdgeWebSocketServer{
		cfg:              cfg,
		log:              slog.With("component", "edge-ws"),
		dispatch:         dispatch,
		snapshotEnvelope: snapshotEnvelope,
		clients:          make(map[*edgeClient]struct{}),
	}
}

func (s *EdgeWebSocketServer) Start(ctx context.Context) error {
	if !s.cfg.Edge.Enabled {
		return nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/ice-config", s.handleIceConfig)
	mux.HandleFunc(s.cfg.Edge.Path, s.handleWebSocket)

	listener, err := net.Listen("tcp", s.cfg.Edge.ListenAddr)
	if err != nil {
		return err
	}

	s.httpServer = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.httpServer.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Warn("edge HTTP shutdown failed", "error", err)
		}
	}()

	go func() {
		if err := s.httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.log.Error("edge HTTP server failed", "error", err)
		}
	}()

	s.log.Info("edge WebSocket server listening",
		"addr", s.cfg.Edge.ListenAddr,
		"path", s.cfg.Edge.Path,
	)

	return nil
}

func (s *EdgeWebSocketServer) Close() {
	if s.httpServer != nil {
		_ = s.httpServer.Close()
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for client := range s.clients {
		_ = client.conn.Close()
		delete(s.clients, client)
	}
}

func (s *EdgeWebSocketServer) Broadcast(service string, subtopic string, env ipc.MQTTEnvelope) int {
	message := edgeOutboundMessage{
		DeviceID: s.cfg.DeviceID,
		Payload:  env,
		Service:  normalizeLegacyServiceName(service),
		Subtopic: strings.TrimPrefix(subtopic, "/"),
		Type:     outboundWebSocketType(service, subtopic, env),
	}

	clients := s.snapshotClients()
	delivered := 0
	for _, client := range clients {
		if err := client.writeJSON(message); err != nil {
			s.log.Warn("edge WebSocket write failed", "error", err)
			s.removeClient(client)
			_ = client.conn.Close()
			continue
		}
		delivered++
	}

	return delivered
}

func (s *EdgeWebSocketServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	if s.handlePreflight(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	s.applyCORSHeaders(w, r)

	response := map[string]interface{}{
		"deviceId": s.cfg.DeviceID,
		"status":   "ok",
		"wsPath":   s.cfg.Edge.Path,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		s.log.Warn("encode health response failed", "error", err)
	}
}

func (s *EdgeWebSocketServer) handleIceConfig(w http.ResponseWriter, r *http.Request) {
	if s.handlePreflight(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	s.applyCORSHeaders(w, r)

	response := map[string]interface{}{
		"iceServers": s.cfg.Edge.WebRTC.ICEServers,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		s.log.Warn("encode ice-config response failed", "error", err)
	}
}

func (s *EdgeWebSocketServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(request *http.Request) bool {
			return s.originAllowed(request.Header.Get("Origin"))
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Warn("edge WebSocket upgrade failed", "error", err)
		return
	}

	client := &edgeClient{conn: conn}
	s.addClient(client)
	defer func() {
		s.removeClient(client)
		_ = conn.Close()
	}()

	requestedDeviceID := strings.TrimSpace(r.URL.Query().Get("deviceId"))
	if requestedDeviceID != "" && requestedDeviceID != s.cfg.DeviceID {
		s.sendImmediateError(client, topicRoute{}, "set-device", "requested device is not available on this edge runtime")
	}

	if err := client.writeJSON(map[string]interface{}{
		"deviceId": s.cfg.DeviceID,
		"type":     "session-info",
	}); err != nil {
		return
	}

	if err := client.writeJSON(edgeOutboundMessage{
		DeviceID: s.cfg.DeviceID,
		Payload:  s.snapshotEnvelope(),
		Type:     "device-status",
	}); err != nil {
		return
	}

	conn.SetReadLimit(1024 * 1024)
	for {
		var message edgeInboundMessage
		if err := conn.ReadJSON(&message); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) &&
				!errors.Is(err, net.ErrClosed) {
				s.log.Debug("edge WebSocket read failed", "error", err)
			}
			return
		}

		s.handleWebSocketMessage(client, message)
	}
}

func (s *EdgeWebSocketServer) handleWebSocketMessage(client *edgeClient, message edgeInboundMessage) {
	if strings.TrimSpace(message.Type) == "" {
		s.sendImmediateError(client, topicRoute{}, "", "message type is required")
		return
	}

	if message.Type == "set-device" {
		s.handleSetDevice(client, message.Payload)
		return
	}

	route, env, err := translateWebSocketMessage(message)
	if err != nil {
		s.sendImmediateError(client, topicRoute{}, message.Type, err.Error())
		return
	}

	if err := s.dispatch(route, env); err != nil {
		s.log.Debug("edge dispatch failed", "service", route.service, "subtopic", route.subtopic, "error", err)
	}
}

func (s *EdgeWebSocketServer) handleSetDevice(client *edgeClient, payload json.RawMessage) {
	requestedDeviceID := s.cfg.DeviceID
	if len(payload) > 0 {
		var request edgeSetDevicePayload
		if err := json.Unmarshal(payload, &request); err != nil {
			s.sendImmediateError(client, topicRoute{}, "set-device", "invalid set-device payload")
			return
		}

		if strings.TrimSpace(request.DeviceID) != "" {
			requestedDeviceID = strings.TrimSpace(request.DeviceID)
		}
	}

	if requestedDeviceID != s.cfg.DeviceID {
		s.sendImmediateError(client, topicRoute{}, "set-device", "requested device is not available on this edge runtime")
		return
	}

	if err := client.writeJSON(map[string]interface{}{
		"deviceId": s.cfg.DeviceID,
		"type":     "session-info",
	}); err != nil {
		return
	}

	_ = client.writeJSON(edgeOutboundMessage{
		DeviceID: s.cfg.DeviceID,
		Payload:  s.snapshotEnvelope(),
		Type:     "device-status",
	})
}

func (s *EdgeWebSocketServer) sendImmediateError(
	client *edgeClient,
	route topicRoute,
	requestType string,
	message string,
) {
	env := buildEnvelope("service-unavailable", marshalPayload(map[string]interface{}{
		"error":       message,
		"requestType": requestType,
		"service":     normalizeLegacyServiceName(route.service),
	}))

	outbound := edgeOutboundMessage{
		DeviceID: s.cfg.DeviceID,
		Payload:  env,
		Service:  normalizeLegacyServiceName(route.service),
		Subtopic: "response",
		Type:     outboundWebSocketType(route.service, "response", env),
	}

	if err := client.writeJSON(outbound); err != nil {
		s.log.Debug("send immediate edge error failed", "error", err)
	}
}

func (s *EdgeWebSocketServer) handlePreflight(w http.ResponseWriter, r *http.Request) bool {
	s.applyCORSHeaders(w, r)

	if r.Method != http.MethodOptions {
		return false
	}

	w.WriteHeader(http.StatusNoContent)
	return true
}

func (s *EdgeWebSocketServer) applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if len(s.cfg.Edge.AllowedOrigins) == 0 {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		return
	}

	if origin == "" || !s.originAllowed(origin) {
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Add("Vary", "Origin")
}

func (s *EdgeWebSocketServer) originAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if len(s.cfg.Edge.AllowedOrigins) == 0 || origin == "" {
		return true
	}

	for _, allowedOrigin := range s.cfg.Edge.AllowedOrigins {
		if strings.EqualFold(strings.TrimSpace(allowedOrigin), origin) {
			return true
		}
	}

	return false
}

func (s *EdgeWebSocketServer) addClient(client *edgeClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clients[client] = struct{}{}
}

func (s *EdgeWebSocketServer) removeClient(client *edgeClient) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, client)
}

func (s *EdgeWebSocketServer) snapshotClients() []*edgeClient {
	s.mu.RLock()
	defer s.mu.RUnlock()

	clients := make([]*edgeClient, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	return clients
}

func normalizeLegacyServiceName(service string) string {
	service = strings.TrimSpace(service)
	if service == "" {
		return ""
	}
	if service == liveFeedServiceName {
		return ""
	}
	return service
}

func outboundWebSocketType(service string, subtopic string, env ipc.MQTTEnvelope) string {
	service = strings.TrimSpace(service)
	subtopic = strings.Trim(strings.TrimSpace(subtopic), "/")

	switch {
	case (service == "" || service == liveFeedServiceName) && subtopic == "response":
		if env.Type == "status" {
			return "device-status"
		}
		return "device-response"
	case (service == "" || service == liveFeedServiceName) && subtopic == "status":
		return "device-status"
	case (service == "" || service == liveFeedServiceName) && subtopic == "webrtc/offer":
		return "sdp-offer"
	case (service == "" || service == liveFeedServiceName) && subtopic == "webrtc/ice":
		return "ice-candidate"
	case service == ptzServiceName && subtopic == "response":
		return "ptz-response"
	case service == ptzServiceName && subtopic == "status":
		return "ptz-status"
	default:
		return "edge-message"
	}
}

func translateWebSocketMessage(message edgeInboundMessage) (topicRoute, ipc.MQTTEnvelope, error) {
	switch message.Type {
	case "publish":
		var payload edgePublishPayload
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			return topicRoute{}, ipc.MQTTEnvelope{}, err
		}

		subtopic := strings.Trim(strings.TrimSpace(payload.Subtopic), "/")
		if subtopic == "" {
			subtopic = defaultCommandSubtopic
		}

		if strings.TrimSpace(payload.Type) == "" {
			return topicRoute{}, ipc.MQTTEnvelope{}, errors.New("publish type is required")
		}

		return topicRoute{
				service:  normalizeInboundService(payload.Service),
				subtopic: subtopic,
			},
			buildEnvelope(payload.Type, payload.Payload),
			nil

	case "get-status", "start-live", "stop-live":
		return topicRoute{service: liveFeedServiceName, subtopic: "command"},
			buildEnvelope(message.Type, message.Payload),
			nil
	case "sdp-answer":
		return topicRoute{service: liveFeedServiceName, subtopic: "webrtc/answer"},
			buildEnvelope(message.Type, message.Payload),
			nil
	case "ice-candidate":
		return topicRoute{service: liveFeedServiceName, subtopic: "webrtc/ice"},
			buildEnvelope(message.Type, message.Payload),
			nil
	case "ptz-get-status":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("get-status", message.Payload),
			nil
	case "ptz-get-position":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("get-position", message.Payload),
			nil
	case "ptz-start-move":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("start-move", message.Payload),
			nil
	case "ptz-stop":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("stop-move", message.Payload),
			nil
	case "ptz-set-zoom":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("set-zoom", message.Payload),
			nil
	case "ptz-go-home":
		return topicRoute{service: ptzServiceName, subtopic: "command"},
			buildEnvelope("go-home", message.Payload),
			nil
	default:
		return topicRoute{}, ipc.MQTTEnvelope{}, errors.New("unsupported edge message type")
	}
}

func normalizeInboundService(service string) string {
	service = strings.TrimSpace(service)
	if service == "" {
		return liveFeedServiceName
	}
	return service
}
