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

type edgeInboundFrame struct {
	DeviceID string           `json:"deviceId,omitempty"`
	Envelope ipc.MQTTEnvelope `json:"envelope"`
	Kind     string           `json:"kind"`
	Service  *string          `json:"service"`
	Subtopic string           `json:"subtopic"`
}

type edgeOutboundPacket struct {
	DeviceID string           `json:"deviceId"`
	Envelope ipc.MQTTEnvelope `json:"envelope"`
	Service  *string          `json:"service"`
	Subtopic string           `json:"subtopic"`
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
	if shouldSuppressOutboundICE(subtopic, env) {
		return 0
	}

	packet := edgeOutboundPacket{
		DeviceID: s.cfg.DeviceID,
		Envelope: env,
		Service:  edgeServicePointer(service),
		Subtopic: normalizeEdgeSubtopic(subtopic),
	}

	clients := s.broadcastTargets(packet)
	delivered := 0
	for _, client := range clients {
		if err := client.writeJSON(packet); err != nil {
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
		s.removeClient(client)
		_ = conn.Close()
	}()

	requestedDeviceID := strings.TrimSpace(r.URL.Query().Get("deviceId"))
	if requestedDeviceID != "" && requestedDeviceID != s.cfg.DeviceID {
		s.sendImmediateError(client, topicRoute{}, "set-device", "requested device is not available on this edge runtime")
	}

	if err := client.writeJSON(map[string]interface{}{
		"deviceId": s.cfg.DeviceID,
		"kind":     "session-info",
	}); err != nil {
		return
	}

	if err := client.writeJSON(edgeOutboundPacket{
		DeviceID: s.cfg.DeviceID,
		Envelope: s.snapshotEnvelope(),
		Service:  nil,
		Subtopic: "status",
	}); err != nil {
		return
	}

	conn.SetReadLimit(1024 * 1024)
	for {
		var message edgeInboundFrame
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

func (s *EdgeWebSocketServer) handleWebSocketMessage(client *edgeClient, message edgeInboundFrame) {
	switch strings.TrimSpace(message.Kind) {
	case "set-device":
		s.handleSetDevice(client, message.DeviceID)
		return
	case "packet":
	default:
		s.sendImmediateError(client, topicRoute{}, "", "message kind is required")
		return
	}

	subtopic := normalizeEdgeSubtopic(message.Subtopic)
	if subtopic == "" {
		s.sendImmediateError(client, topicRoute{}, message.Envelope.Type, "subtopic is required")
		return
	}

	envelope, err := normalizeEdgeEnvelope(message.Envelope)
	if err != nil {
		s.sendImmediateError(client, topicRoute{
			service:  normalizeInboundService(message.Service),
			subtopic: subtopic,
		}, "", err.Error())
		return
	}

	requestID, sessionID := edgeEnvelopeIDs(envelope)
	if requestID != "" {
		s.registerRequestOwner(client, requestID)
	}
	if sessionID != "" && !s.clientOwnsSession(client, sessionID) {
		return
	}

	route := topicRoute{
		service:  normalizeInboundService(message.Service),
		subtopic: subtopic,
	}
	if err := s.dispatch(route, envelope); err != nil {
		s.log.Debug("edge dispatch failed", "service", route.service, "subtopic", route.subtopic, "error", err)
	}
}

func (s *EdgeWebSocketServer) handleSetDevice(client *edgeClient, requestedDeviceID string) {
	deviceID := strings.TrimSpace(requestedDeviceID)
	if deviceID == "" {
		deviceID = s.cfg.DeviceID
	}

	if deviceID != s.cfg.DeviceID {
		s.sendImmediateError(client, topicRoute{}, "set-device", "requested device is not available on this edge runtime")
		return
	}

	if err := client.writeJSON(map[string]interface{}{
		"deviceId": s.cfg.DeviceID,
		"kind":     "session-info",
	}); err != nil {
		return
	}

	_ = client.writeJSON(edgeOutboundPacket{
		DeviceID: s.cfg.DeviceID,
		Envelope: s.snapshotEnvelope(),
		Service:  nil,
		Subtopic: "status",
	})
}

func (s *EdgeWebSocketServer) sendImmediateError(
	client *edgeClient,
	route topicRoute,
	requestType string,
	message string,
) {
	packet := edgeOutboundPacket{
		DeviceID: s.cfg.DeviceID,
		Envelope: buildEnvelope("service-unavailable", marshalPayload(map[string]interface{}{
			"error":       message,
			"requestType": requestType,
			"service":     route.service,
			"subtopic":    route.subtopic,
		})),
		Service:  edgeServicePointer(route.service),
		Subtopic: "response",
	}

	if err := client.writeJSON(packet); err != nil {
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

func (s *EdgeWebSocketServer) broadcastTargets(packet edgeOutboundPacket) []*edgeClient {
	if client := s.packetOwner(packet); client != nil {
		return []*edgeClient{client}
	}

	return s.snapshotClients()
}

func (s *EdgeWebSocketServer) clientOwnsSession(client *edgeClient, sessionID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	owner, ok := s.sessionOwners[strings.TrimSpace(sessionID)]
	return !ok || owner == client
}

func (s *EdgeWebSocketServer) packetOwner(packet edgeOutboundPacket) *edgeClient {
	requestID, sessionID := edgeEnvelopeIDs(packet.Envelope)

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

func normalizeEdgeEnvelope(env ipc.MQTTEnvelope) (ipc.MQTTEnvelope, error) {
	msgType := strings.TrimSpace(env.Type)
	if msgType == "" {
		return ipc.MQTTEnvelope{}, errors.New("envelope type is required")
	}

	payload := env.Payload
	if len(payload) == 0 {
		payload = marshalPayload(map[string]interface{}{})
	}

	msgID := strings.TrimSpace(env.MsgID)
	if msgID == "" {
		msgID = buildEnvelope(msgType, payload).MsgID
	}

	timestamp := strings.TrimSpace(env.Timestamp)
	if timestamp == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	return ipc.MQTTEnvelope{
		MsgID:     msgID,
		Payload:   payload,
		Timestamp: timestamp,
		Type:      msgType,
	}, nil
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

func edgeEnvelopeOrigin(env ipc.MQTTEnvelope) string {
	if len(env.Payload) == 0 {
		return ""
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(env.Payload, &decoded); err != nil || decoded == nil {
		return ""
	}

	return readEdgeString(decoded["origin"])
}

func readEdgeString(value interface{}) string {
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}

	return strings.TrimSpace(stringValue)
}

func shouldSuppressOutboundICE(subtopic string, env ipc.MQTTEnvelope) bool {
	return normalizeEdgeSubtopic(subtopic) == "webrtc/ice" && edgeEnvelopeOrigin(env) == "browser"
}

func normalizeEdgeSubtopic(subtopic string) string {
	return strings.Trim(strings.TrimSpace(subtopic), "/")
}

func normalizeInboundService(service *string) string {
	if service == nil {
		return ""
	}

	return strings.TrimSpace(*service)
}

func edgeServicePointer(service string) *string {
	normalized := strings.TrimSpace(service)
	if normalized == "" {
		return nil
	}

	return &normalized
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
