package cloudcomm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	mu             sync.RWMutex
	clientRequests map[*edgeClient]map[string]struct{}
	clientSessions map[*edgeClient]map[string]struct{}
	clients        map[*edgeClient]struct{}
	requestOwners  map[string]*edgeClient
	sessionOwners  map[string]*edgeClient

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
		clientRequests:   make(map[*edgeClient]map[string]struct{}),
		clientSessions:   make(map[*edgeClient]map[string]struct{}),
		requestOwners:    make(map[string]*edgeClient),
		sessionOwners:    make(map[string]*edgeClient),
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

	clients := s.broadcastTargets(message)
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

	w.Header().Set("Cache-Control", "no-store")
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

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	s.applyCORSHeaders(w, r)

	if err := json.NewEncoder(w).Encode(s.edgeICEConfigResponse()); err != nil {
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
		s.stopClientSessions(client)
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

	if message.Type == "start-live" {
		var requestID string
		message, requestID = ensureEdgeLiveRequestID(message)
		s.registerRequestOwner(client, requestID)
	}

	if message.Type == "sdp-answer" || message.Type == "ice-candidate" || message.Type == "stop-live" {
		_, sessionID := edgeMessageIDs(message.Payload)
		if sessionID != "" && !s.liveClientMatches(client, sessionID) {
			return
		}
		if message.Type == "stop-live" {
			if sessionID == "" {
				s.clearClientLiveRoutes(client)
			} else {
				s.unregisterSessionOwner(sessionID)
			}
		}
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
	s.clientRequests[client] = make(map[string]struct{})
	s.clientSessions[client] = make(map[string]struct{})
}

func (s *EdgeWebSocketServer) removeClient(client *edgeClient) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if requestIDs, ok := s.clientRequests[client]; ok {
		for requestID := range requestIDs {
			delete(s.requestOwners, requestID)
		}
		delete(s.clientRequests, client)
	}

	if sessionIDs, ok := s.clientSessions[client]; ok {
		for sessionID := range sessionIDs {
			delete(s.sessionOwners, sessionID)
		}
		delete(s.clientSessions, client)
	}

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

func (s *EdgeWebSocketServer) broadcastTargets(message edgeOutboundMessage) []*edgeClient {
	if client := s.liveMessageOwner(message); client != nil {
		return []*edgeClient{client}
	}

	return s.snapshotClients()
}

func (s *EdgeWebSocketServer) liveClientMatches(client *edgeClient, sessionID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	owner, ok := s.sessionOwners[strings.TrimSpace(sessionID)]
	return !ok || owner == client
}

func (s *EdgeWebSocketServer) liveMessageOwner(message edgeOutboundMessage) *edgeClient {
	requestID, sessionID := edgeEnvelopeIDs(message.Payload)

	s.mu.Lock()
	defer s.mu.Unlock()

	if sessionID != "" {
		if owner, ok := s.sessionOwners[sessionID]; ok {
			return owner
		}
	}

	if requestID != "" {
		if owner, ok := s.requestOwners[requestID]; ok {
			if sessionID != "" {
				s.bindSessionOwnerLocked(owner, sessionID)
			}
			return owner
		}
	}

	return nil
}

func (s *EdgeWebSocketServer) registerRequestOwner(client *edgeClient, requestID string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.clientRequests[client]; !ok {
		s.clientRequests[client] = make(map[string]struct{})
	}
	s.requestOwners[requestID] = client
	s.clientRequests[client][requestID] = struct{}{}
}

func (s *EdgeWebSocketServer) unregisterSessionOwner(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	owner, ok := s.sessionOwners[sessionID]
	if !ok {
		return
	}

	delete(s.sessionOwners, sessionID)
	if sessions := s.clientSessions[owner]; sessions != nil {
		delete(sessions, sessionID)
	}
}

func (s *EdgeWebSocketServer) clearClientLiveRoutes(client *edgeClient) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for requestID := range s.clientRequests[client] {
		delete(s.requestOwners, requestID)
	}
	clear(s.clientRequests[client])

	for sessionID := range s.clientSessions[client] {
		delete(s.sessionOwners, sessionID)
	}
	clear(s.clientSessions[client])
}

func (s *EdgeWebSocketServer) stopClientSessions(client *edgeClient) {
	sessionIDs := s.snapshotClientSessionIDs(client)
	for _, sessionID := range sessionIDs {
		route := topicRoute{service: liveFeedServiceName, subtopic: "command"}
		env := buildEnvelope("stop-live", marshalPayload(map[string]interface{}{
			"sessionId": sessionID,
		}))
		if err := s.dispatch(route, env); err != nil {
			s.log.Debug("edge dispatch failed while stopping client session", "sessionId", sessionID, "error", err)
		}
	}
}

func (s *EdgeWebSocketServer) snapshotClientSessionIDs(client *edgeClient) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sessionIDs := make([]string, 0, len(s.clientSessions[client]))
	for sessionID := range s.clientSessions[client] {
		sessionIDs = append(sessionIDs, sessionID)
	}
	return sessionIDs
}

func (s *EdgeWebSocketServer) bindSessionOwnerLocked(client *edgeClient, sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	if _, ok := s.clientSessions[client]; !ok {
		s.clientSessions[client] = make(map[string]struct{})
	}
	s.sessionOwners[sessionID] = client
	s.clientSessions[client][sessionID] = struct{}{}
}

func ensureEdgeLiveRequestID(message edgeInboundMessage) (edgeInboundMessage, string) {
	requestID, _ := edgeMessageIDs(message.Payload)
	if requestID != "" {
		return message, requestID
	}

	payload := edgePayloadMap(message.Payload)
	requestID = fmt.Sprintf("edge-%d", time.Now().UnixNano())
	payload["requestId"] = requestID

	message.Payload = marshalPayload(payload)
	return message, requestID
}

func edgePayloadMap(payload json.RawMessage) map[string]interface{} {
	if len(payload) == 0 {
		return map[string]interface{}{}
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(payload, &decoded); err != nil || decoded == nil {
		return map[string]interface{}{}
	}

	return decoded
}

func edgeMessageIDs(payload json.RawMessage) (string, string) {
	decoded := edgePayloadMap(payload)
	return readEdgeString(decoded["requestId"]), readEdgeString(decoded["sessionId"])
}

func edgeEnvelopeIDs(env ipc.MQTTEnvelope) (string, string) {
	if len(env.Payload) == 0 {
		return "", ""
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(env.Payload, &decoded); err != nil || decoded == nil {
		return "", ""
	}

	return readEdgeString(decoded["requestId"]), readEdgeString(decoded["sessionId"])
}

func readEdgeString(value interface{}) string {
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}

	return strings.TrimSpace(stringValue)
}

func (s *EdgeWebSocketServer) edgeICEConfigResponse() map[string]interface{} {
	iceServers := make([]map[string]interface{}, 0, len(s.cfg.Edge.WebRTC.ICEServers))

	for _, server := range s.cfg.Edge.WebRTC.ICEServers {
		urls := make([]string, 0, len(server.URLs))
		for _, url := range server.URLs {
			if trimmedURL := strings.TrimSpace(url); trimmedURL != "" {
				urls = append(urls, trimmedURL)
			}
		}
		if len(urls) == 0 {
			continue
		}

		entry := map[string]interface{}{}
		if len(urls) == 1 {
			entry["urls"] = urls[0]
		} else {
			entry["urls"] = urls
		}

		if username := strings.TrimSpace(server.Username); username != "" {
			entry["username"] = username
		}
		if credential := strings.TrimSpace(server.Credential); credential != "" {
			entry["credential"] = credential
		}

		iceServers = append(iceServers, entry)
	}

	return map[string]interface{}{
		"iceServers": iceServers,
	}
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

	case "get-status", "start-live", "update-live-layout", "stop-live":
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
