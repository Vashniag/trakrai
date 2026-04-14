package livefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

type MessagePublisher interface {
	Publish(subtopic string, msgType string, payload interface{}) error
}

type ControlPlane interface {
	MessagePublisher
	ReportStatus(status string, details map[string]interface{}) error
}

type liveSession struct {
	cameraName      string
	cancel          context.CancelFunc
	disconnectTimer *time.Timer
	layoutPlan      LiveLayoutPlan
	pc              *webrtc.PeerConnection
	pendingICE      []webrtc.ICECandidateInit
	requestID       string
	sessionID       string
	state           string
}

type SessionManager struct {
	api      *webrtc.API
	mu       sync.Mutex
	control  ControlPlane
	composer *MosaicComposer
	frameSrc *FrameSource
	cfg      *Config
	log      *slog.Logger
	sessions map[string]*liveSession
}

func NewSessionManager(cfg *Config, frameSource *FrameSource, control ControlPlane) *SessionManager {
	return &SessionManager{
		api:      buildWebRTCAPI(cfg),
		cfg:      cfg,
		frameSrc: frameSource,
		composer: NewMosaicComposer(cfg.Composite, frameSource),
		control:  control,
		log:      slog.With("component", "webrtc"),
		sessions: make(map[string]*liveSession),
	}
}

func (sm *SessionManager) StartSession(plan LiveLayoutPlan, requestID string) {
	cameraName := plan.PrimaryCamera()
	sm.log.Info("starting WebRTC session",
		"camera", cameraName,
		"layoutMode", plan.Mode,
		"cameraCount", len(plan.CameraNames),
	)
	sessionID := fmt.Sprintf("%d", time.Now().UnixNano())

	iceServers := []webrtc.ICEServer{}
	for _, stun := range sm.cfg.WebRTC.STUNServers {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: []string{stun}})
	}
	if sm.cfg.WebRTC.AdvertiseRelayCandidates {
		for _, turn := range sm.cfg.WebRTC.TURNServers {
			iceServers = append(iceServers, webrtc.ICEServer{
				URLs:           []string{turn.URL},
				Username:       turn.Username,
				Credential:     turn.Credential,
				CredentialType: webrtc.ICECredentialTypePassword,
			})
		}
	}

	pc, err := sm.api.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		sm.log.Error("peer connection failed", "error", err)
		sm.sendAck(cameraName, sessionID, requestID, false, err.Error())
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	session := &liveSession{
		cameraName: cameraName,
		layoutPlan: plan,
		pc:         pc,
		requestID:  strings.TrimSpace(requestID),
		sessionID:  sessionID,
		state:      "starting",
	}

	videoTrack, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeH264,
			ClockRate: 90000,
		},
		"video",
		"trakrai-live",
	)
	if err != nil {
		sm.log.Error("create track failed", "error", err)
		_ = pc.Close()
		sm.sendAck(cameraName, sessionID, requestID, false, err.Error())
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	if _, err := pc.AddTrack(videoTrack); err != nil {
		sm.log.Error("add track failed", "error", err)
		_ = pc.Close()
		sm.sendAck(cameraName, sessionID, requestID, false, err.Error())
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if !sm.isCurrentSession(sessionID, pc) {
			return
		}
		candidateJSON := candidate.ToJSON()
		sm.log.Debug(
			"local ICE candidate gathered",
			"session_id", sessionID,
			"camera", cameraName,
			"candidate", candidateSummary(candidateJSON),
		)
		payload := map[string]interface{}{
			"candidate": candidateJSON,
			"origin":    "device",
			"sessionId": sessionID,
		}
		if session.requestID != "" {
			payload["requestId"] = session.requestID
		}
		sm.publish("webrtc/ice", "ice-candidate", payload)
	})

	pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		sm.log.Info(
			"ICE connection state changed",
			"state", state.String(),
			"session_id", sessionID,
			"camera", cameraName,
		)
	})

	pc.OnICEGatheringStateChange(func(state webrtc.ICEGatheringState) {
		sm.log.Info(
			"ICE gathering state changed",
			"state", state.String(),
			"session_id", sessionID,
			"camera", cameraName,
		)
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		sm.log.Info("connection state changed", "state", state.String(), "session_id", sessionID, "camera", cameraName)
		if !sm.isCurrentSession(sessionID, pc) {
			return
		}
		switch state {
		case webrtc.PeerConnectionStateConnecting:
			sm.clearDisconnectTimer(sessionID)
			sm.setSessionState(sessionID, "negotiating")
			sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"requestId":      session.requestID,
				"sessionId":      sessionID,
			}))
		case webrtc.PeerConnectionStateConnected:
			sm.clearDisconnectTimer(sessionID)
			sm.setSessionState(sessionID, "streaming")
			sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"requestId":      session.requestID,
				"sessionId":      sessionID,
			}))
		case webrtc.PeerConnectionStateDisconnected:
			sm.log.Warn("peer connection temporarily disconnected", "session_id", sessionID, "camera", cameraName)
			sm.setSessionState(sessionID, "negotiating")
			sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"phase":          "waiting-reconnect",
				"requestId":      session.requestID,
				"sessionId":      sessionID,
			}))
			sm.scheduleDisconnectTimeout(sessionID, cameraName, pc, session.requestID)
			return
		}
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			sm.stopSessionWithDetails(sessionID, mergeLayoutDetails(plan, map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"reason":         "peer-connection-closed",
				"requestId":      session.requestID,
				"sessionId":      sessionID,
			}))
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		sm.log.Error("create offer failed", "error", err)
		sm.removeSession(sessionID)
		_ = pc.Close()
		sm.sendAck(cameraName, sessionID, requestID, false, err.Error())
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		sm.log.Error("set local desc failed", "error", err)
		sm.removeSession(sessionID)
		_ = pc.Close()
		sm.sendAck(cameraName, sessionID, requestID, false, err.Error())
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	localDesc := pc.LocalDescription()
	if localDesc == nil {
		sm.removeSession(sessionID)
		_ = pc.Close()
		sm.sendAck(cameraName, sessionID, requestID, false, "local description was not created")
		sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
			"camera":    cameraName,
			"error":     "local description was not created",
			"requestId": requestID,
			"sessionId": sessionID,
		}))
		return
	}

	sm.setSessionState(sessionID, "negotiating")
	sm.sendAck(cameraName, sessionID, requestID, true, "")
	offerPayload := map[string]interface{}{
		"cameraName": cameraName,
		"sdp":        localDesc.SDP,
		"sessionId":  sessionID,
	}
	if session.requestID != "" {
		offerPayload["requestId"] = session.requestID
	}
	sm.publish("webrtc/offer", "sdp-offer", offerPayload)
	sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
		"camera":    cameraName,
		"phase":     "offer-sent",
		"requestId": requestID,
		"sessionId": sessionID,
	}))
	sm.log.Info("SDP offer sent", "session_id", sessionID)

	sessionCtx, cancel := context.WithCancel(context.Background())
	sm.mu.Lock()
	if currentSession := sm.sessions[sessionID]; currentSession != nil {
		currentSession.cancel = cancel
	}
	sm.mu.Unlock()

	go sm.pumpFrames(sessionCtx, sessionID, videoTrack)
}

func (sm *SessionManager) pumpFrames(
	ctx context.Context,
	sessionID string,
	track *webrtc.TrackLocalStaticSample,
) {
	fps := sm.cfg.WebRTC.FramerateFPS
	if fps <= 0 {
		fps = 10
	}

	encoder, err := NewH264Encoder(sm.cfg.Composite.Width, sm.cfg.Composite.Height, fps)
	if err != nil {
		sm.log.Error("encoder creation failed", "error", err)
		return
	}
	defer encoder.Stop()

	frameDuration := time.Duration(float64(time.Second) / float64(fps))
	var pts uint64
	ticker := time.NewTicker(frameDuration)
	defer ticker.Stop()

	sm.log.Info("frame pump started",
		"session_id", sessionID,
		"fps", fps,
		"width", sm.cfg.Composite.Width,
		"height", sm.cfg.Composite.Height,
	)

	for {
		select {
		case <-ctx.Done():
			sm.log.Info("frame pump stopped")
			return
		case <-ticker.C:
			plan, ok := sm.sessionPlan(sessionID)
			if !ok {
				return
			}

			rgbaFrame, err := sm.composer.ComposeRGBAFrame(ctx, plan)
			if err != nil {
				sm.log.Debug("composite frame failed", "error", err, "session_id", sessionID)
				pts += uint64(frameDuration.Nanoseconds())
				continue
			}

			h264Data, err := encoder.Encode(rgbaFrame, pts)
			if err != nil {
				sm.log.Debug("encode failed", "error", err)
				pts += uint64(frameDuration.Nanoseconds())
				continue
			}

			if err := track.WriteSample(media.Sample{
				Data:     h264Data,
				Duration: frameDuration,
			}); err != nil {
				sm.log.Warn("write sample failed", "error", err)
			}

			pts += uint64(frameDuration.Nanoseconds())
		}
	}
}

func (sm *SessionManager) SetRemoteAnswer(sessionID string, sdp string) {
	sm.mu.Lock()
	session := sm.lookupSessionLocked(sessionID)
	if session == nil || session.pc == nil {
		sm.mu.Unlock()
		sm.log.Warn("no active session for SDP answer")
		return
	}
	if session.pc.RemoteDescription() != nil {
		sm.mu.Unlock()
		sm.log.Warn("remote description already set, ignoring duplicate SDP answer")
		return
	}

	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	}
	if err := session.pc.SetRemoteDescription(answer); err != nil {
		sm.mu.Unlock()
		sm.log.Error("set remote desc failed", "error", err)
		return
	}

	for _, candidate := range session.pendingICE {
		if err := session.pc.AddICECandidate(candidate); err != nil {
			sm.log.Error("add buffered ICE candidate failed", "error", err)
		}
	}
	session.pendingICE = nil
	activeSessionID := session.sessionID
	sm.mu.Unlock()

	sm.log.Info("SDP answer applied", "session_id", activeSessionID)
}

func (sm *SessionManager) AddICECandidate(sessionID string, candidateJSON json.RawMessage) {
	sm.mu.Lock()
	session := sm.lookupSessionLocked(sessionID)
	if session == nil || session.pc == nil {
		sm.mu.Unlock()
		sm.log.Warn("no active session for ICE candidate")
		return
	}

	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(candidateJSON, &candidate); err != nil {
		sm.mu.Unlock()
		sm.log.Error("invalid ICE candidate", "error", err)
		return
	}

	sm.log.Debug(
		"remote ICE candidate received",
		"session_id", session.sessionID,
		"camera", session.cameraName,
		"candidate", candidateSummary(candidate),
	)

	if session.pc.RemoteDescription() == nil {
		session.pendingICE = append(session.pendingICE, candidate)
		activeSessionID := session.sessionID
		cameraName := session.cameraName
		sm.mu.Unlock()
		sm.log.Debug(
			"buffering ICE candidate until remote description is set",
			"session_id", activeSessionID,
			"camera", cameraName,
		)
		return
	}

	if err := session.pc.AddICECandidate(candidate); err != nil {
		sm.mu.Unlock()
		sm.log.Error("add ICE candidate failed", "error", err)
		return
	}
	sm.mu.Unlock()
}

func (sm *SessionManager) UpdateSessionLayout(sessionID string, plan LiveLayoutPlan) error {
	sm.mu.Lock()
	session := sm.lookupSessionLocked(sessionID)
	if session == nil {
		sm.mu.Unlock()
		return fmt.Errorf("no active live session")
	}

	session.layoutPlan = plan
	session.cameraName = plan.PrimaryCamera()
	requestID := session.requestID
	activeSessionID := session.sessionID
	sm.mu.Unlock()

	sm.reportAggregateStatus(mergeLayoutDetails(plan, map[string]interface{}{
		"camera":    plan.PrimaryCamera(),
		"phase":     "layout-updated",
		"requestId": requestID,
		"sessionId": activeSessionID,
	}))
	sm.publish("response", "live-layout-updated", map[string]interface{}{
		"cameraName":  plan.PrimaryCamera(),
		"cameraNames": slices.Clone(plan.CameraNames),
		"layoutMode":  string(plan.Mode),
		"requestId":   requestID,
		"sessionId":   activeSessionID,
	})

	return nil
}

func (sm *SessionManager) StopSession(sessionID string) {
	if strings.TrimSpace(sessionID) == "" {
		sm.stopAllSessions(map[string]interface{}{"reason": "stop-request"})
		return
	}

	sm.stopSessionWithDetails(strings.TrimSpace(sessionID), map[string]interface{}{
		"reason":    "stop-request",
		"sessionId": strings.TrimSpace(sessionID),
	})
}

func (sm *SessionManager) stopAllSessions(extra map[string]interface{}) {
	sm.mu.Lock()
	sessions := make([]*liveSession, 0, len(sm.sessions))
	for sessionID, session := range sm.sessions {
		sessions = append(sessions, session)
		delete(sm.sessions, sessionID)
	}
	status, details := sm.buildStatusSnapshotLocked(extra)
	sm.mu.Unlock()

	for _, session := range sessions {
		sm.closeSessionResources(session)
	}

	sm.reportStatus(status, details)
}

func (sm *SessionManager) stopSessionWithDetails(sessionID string, extra map[string]interface{}) {
	sm.mu.Lock()
	session, ok := sm.sessions[sessionID]
	if !ok {
		sm.mu.Unlock()
		return
	}
	delete(sm.sessions, sessionID)
	status, details := sm.buildStatusSnapshotLocked(extra)
	sm.mu.Unlock()

	sm.closeSessionResources(session)
	sm.log.Info("WebRTC session stopped", "camera", session.cameraName, "session_id", session.sessionID)
	sm.reportStatus(status, details)
}

func (sm *SessionManager) closeSessionResources(session *liveSession) {
	if session == nil {
		return
	}

	if session.cancel != nil {
		session.cancel()
		session.cancel = nil
	}
	if session.disconnectTimer != nil {
		session.disconnectTimer.Stop()
		session.disconnectTimer = nil
	}
	if session.pc != nil {
		_ = session.pc.Close()
		session.pc = nil
	}
	session.pendingICE = nil
}

func (sm *SessionManager) scheduleDisconnectTimeout(
	sessionID string,
	cameraName string,
	pc *webrtc.PeerConnection,
	requestID string,
) {
	sm.mu.Lock()
	session, ok := sm.sessions[sessionID]
	if !ok {
		sm.mu.Unlock()
		return
	}
	if session.disconnectTimer != nil {
		session.disconnectTimer.Stop()
	}
	session.disconnectTimer = time.AfterFunc(12*time.Second, func() {
		shouldStop := false

		sm.mu.Lock()
		currentSession, ok := sm.sessions[sessionID]
		if ok && currentSession == session && currentSession.pc == pc &&
			pc.ConnectionState() == webrtc.PeerConnectionStateDisconnected {
			shouldStop = true
		}
		if ok && currentSession != nil {
			currentSession.disconnectTimer = nil
		}
		sm.mu.Unlock()

		if !shouldStop {
			return
		}

		sm.log.Warn("peer connection did not recover before timeout", "session_id", sessionID, "camera", cameraName)
		sm.stopSessionWithDetails(sessionID, map[string]interface{}{
			"camera":         cameraName,
			"peerConnection": webrtc.PeerConnectionStateDisconnected.String(),
			"reason":         "disconnect-timeout",
			"requestId":      requestID,
			"sessionId":      sessionID,
		})
	})
	sm.mu.Unlock()
}

func (sm *SessionManager) clearDisconnectTimer(sessionID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok || session.disconnectTimer == nil {
		return
	}

	session.disconnectTimer.Stop()
	session.disconnectTimer = nil
}

func (sm *SessionManager) publish(subtopic string, msgType string, payload interface{}) {
	if sm.control == nil {
		sm.log.Warn("publish skipped because message publisher is not configured", "subtopic", subtopic, "type", msgType)
		return
	}
	if err := sm.control.Publish(subtopic, msgType, payload); err != nil {
		sm.log.Warn("publish failed", "subtopic", subtopic, "type", msgType, "error", err)
	}
}

func (sm *SessionManager) reportStatus(status string, details map[string]interface{}) {
	if sm.control == nil {
		return
	}
	if err := sm.control.ReportStatus(status, details); err != nil {
		sm.log.Debug("status report failed", "status", status, "error", err)
	}
}

func (sm *SessionManager) sendAck(
	cameraName string,
	sessionID string,
	requestID string,
	ok bool,
	errMsg string,
) {
	payload := map[string]interface{}{
		"cameraName": cameraName,
		"ok":         ok,
		"sessionId":  sessionID,
	}
	if strings.TrimSpace(requestID) != "" {
		payload["requestId"] = strings.TrimSpace(requestID)
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	sm.publish("response", "start-live-ack", payload)
}

func (sm *SessionManager) isCurrentSession(
	sessionID string,
	pc *webrtc.PeerConnection,
) bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, ok := sm.sessions[sessionID]
	return ok && session != nil && session.pc == pc
}

func (sm *SessionManager) setSessionState(sessionID string, state string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if session, ok := sm.sessions[sessionID]; ok && session != nil {
		session.state = state
	}
}

func (sm *SessionManager) sessionPlan(sessionID string) (LiveLayoutPlan, bool) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, ok := sm.sessions[sessionID]
	if !ok || session == nil {
		return LiveLayoutPlan{}, false
	}

	return session.layoutPlan, true
}

func (sm *SessionManager) lookupSessionLocked(sessionID string) *liveSession {
	if strings.TrimSpace(sessionID) != "" {
		return sm.sessions[strings.TrimSpace(sessionID)]
	}

	if len(sm.sessions) != 1 {
		return nil
	}

	for _, session := range sm.sessions {
		return session
	}

	return nil
}

func (sm *SessionManager) removeSession(sessionID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	delete(sm.sessions, sessionID)
}

func (sm *SessionManager) buildStatusSnapshotLocked(
	extra map[string]interface{},
) (string, map[string]interface{}) {
	details := make(map[string]interface{}, len(extra)+3)

	sessionIDs := make([]string, 0, len(sm.sessions))
	for sessionID := range sm.sessions {
		sessionIDs = append(sessionIDs, sessionID)
	}
	sort.Strings(sessionIDs)

	sessionSummaries := make([]map[string]interface{}, 0, len(sessionIDs))
	overallStatus := "idle"
	hasNegotiatingSession := false
	hasStartingSession := false

	for _, sessionID := range sessionIDs {
		session := sm.sessions[sessionID]
		if session == nil {
			continue
		}

		summary := map[string]interface{}{
			"camera":    session.cameraName,
			"sessionId": session.sessionID,
			"status":    session.state,
		}
		for key, value := range session.layoutPlan.Details() {
			summary[key] = value
		}
		if session.requestID != "" {
			summary["requestId"] = session.requestID
		}
		sessionSummaries = append(sessionSummaries, summary)

		switch session.state {
		case "streaming":
			overallStatus = "streaming"
		case "negotiating":
			if overallStatus != "streaming" {
				hasNegotiatingSession = true
			}
		case "starting":
			if overallStatus != "streaming" && !hasNegotiatingSession {
				hasStartingSession = true
			}
		}
	}

	if overallStatus != "streaming" {
		switch {
		case hasNegotiatingSession:
			overallStatus = "negotiating"
		case hasStartingSession:
			overallStatus = "starting"
		}
	}

	if len(sessionSummaries) > 0 {
		details["camera"] = sessionSummaries[0]["camera"]
		details["cameraNames"] = sessionSummaries[0]["cameraNames"]
		details["layoutMode"] = sessionSummaries[0]["layoutMode"]
		details["primaryCamera"] = sessionSummaries[0]["primaryCamera"]
		details["sessionCount"] = len(sessionSummaries)
		details["sessions"] = sessionSummaries
	}

	for key, value := range extra {
		if value == nil {
			continue
		}
		details[key] = value
	}

	return overallStatus, details
}

func (sm *SessionManager) reportAggregateStatus(extra map[string]interface{}) {
	sm.mu.Lock()
	status, details := sm.buildStatusSnapshotLocked(extra)
	sm.mu.Unlock()

	sm.reportStatus(status, details)
}

func candidateSummary(candidate webrtc.ICECandidateInit) string {
	candidateValue := strings.TrimSpace(candidate.Candidate)
	if candidateValue == "" {
		return "empty"
	}

	fields := strings.Fields(candidateValue)
	if len(fields) >= 8 {
		return fmt.Sprintf("%s %s %s", fields[4], fields[5], fields[7])
	}

	return candidateValue
}

func mergeLayoutDetails(plan LiveLayoutPlan, details map[string]interface{}) map[string]interface{} {
	if details == nil {
		details = make(map[string]interface{}, len(plan.CameraNames)+2)
	}

	for key, value := range plan.Details() {
		details[key] = value
	}

	return details
}
