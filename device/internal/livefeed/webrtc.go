package livefeed

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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

type SessionManager struct {
	mu              sync.Mutex
	pc              *webrtc.PeerConnection
	cancel          context.CancelFunc
	control         ControlPlane
	frameSrc        *FrameSource
	cfg             *Config
	log             *slog.Logger
	disconnectTimer *time.Timer
	pendingICE      []webrtc.ICECandidateInit
	sessionID       string
	cameraName      string
}

func NewSessionManager(cfg *Config, frameSource *FrameSource, control ControlPlane) *SessionManager {
	return &SessionManager{
		cfg:      cfg,
		frameSrc: frameSource,
		control:  control,
		log:      slog.With("component", "webrtc"),
	}
}

func (sm *SessionManager) StartSession(cameraName string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.stopLocked()
	sm.log.Info("starting WebRTC session", "camera", cameraName)
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

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		sm.log.Error("peer connection failed", "error", err)
		sm.sendAck(cameraName, sessionID, false, err.Error())
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"sessionId": sessionID,
		})
		return
	}
	sm.pc = pc
	sm.pendingICE = nil
	sm.sessionID = sessionID
	sm.cameraName = cameraName

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
		pc.Close()
		sm.pc = nil
		sm.sessionID = ""
		sm.cameraName = ""
		sm.sendAck(cameraName, sessionID, false, err.Error())
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"sessionId": sessionID,
		})
		return
	}

	if _, err := pc.AddTrack(videoTrack); err != nil {
		sm.log.Error("add track failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sessionID = ""
		sm.cameraName = ""
		sm.sendAck(cameraName, sessionID, false, err.Error())
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"sessionId": sessionID,
		})
		return
	}

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
		sm.publish("webrtc/ice", "ice-candidate", map[string]interface{}{
			"candidate": candidateJSON,
			"sessionId": sessionID,
		})
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
			sm.clearDisconnectTimer()
			sm.reportStatus("negotiating", map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"sessionId":      sessionID,
			})
		case webrtc.PeerConnectionStateConnected:
			sm.clearDisconnectTimer()
			sm.reportStatus("streaming", map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"sessionId":      sessionID,
			})
		case webrtc.PeerConnectionStateDisconnected:
			sm.log.Warn("peer connection temporarily disconnected", "session_id", sessionID, "camera", cameraName)
			sm.reportStatus("negotiating", map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"phase":          "waiting-reconnect",
				"sessionId":      sessionID,
			})
			sm.scheduleDisconnectTimeout(sessionID, cameraName, pc)
			return
		}
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			sm.clearDisconnectTimer()
			sm.reportStatus("idle", map[string]interface{}{
				"camera":         cameraName,
				"peerConnection": state.String(),
				"reason":         "peer-connection-closed",
				"sessionId":      sessionID,
			})
			sm.StopSession()
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		sm.log.Error("create offer failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sessionID = ""
		sm.cameraName = ""
		sm.sendAck(cameraName, sessionID, false, err.Error())
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"sessionId": sessionID,
		})
		return
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		sm.log.Error("set local desc failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sessionID = ""
		sm.cameraName = ""
		sm.sendAck(cameraName, sessionID, false, err.Error())
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     err.Error(),
			"sessionId": sessionID,
		})
		return
	}

	localDesc := pc.LocalDescription()
	if localDesc == nil {
		pc.Close()
		sm.pc = nil
		sm.sessionID = ""
		sm.cameraName = ""
		sm.sendAck(cameraName, sessionID, false, "local description was not created")
		sm.reportStatus("idle", map[string]interface{}{
			"camera":    cameraName,
			"error":     "local description was not created",
			"sessionId": sessionID,
		})
		return
	}

	sm.sendAck(cameraName, sessionID, true, "")
	sm.publish("webrtc/offer", "sdp-offer", map[string]interface{}{
		"cameraName": cameraName,
		"sdp":        localDesc.SDP,
		"sessionId":  sessionID,
	})
	sm.reportStatus("negotiating", map[string]interface{}{
		"camera":    cameraName,
		"phase":     "offer-sent",
		"sessionId": sessionID,
	})
	sm.log.Info("SDP offer sent", "session_id", sessionID)

	sessionCtx, cancel := context.WithCancel(context.Background())
	sm.cancel = cancel

	go sm.pumpFrames(sessionCtx, cameraName, videoTrack)
}

func (sm *SessionManager) pumpFrames(
	ctx context.Context,
	cameraName string,
	track *webrtc.TrackLocalStaticSample,
) {
	fps := sm.cfg.WebRTC.FramerateFPS
	if fps <= 0 {
		fps = 10
	}

	encoder, err := NewH264Encoder(fps)
	if err != nil {
		sm.log.Error("encoder creation failed", "error", err)
		return
	}
	defer encoder.Stop()

	frameCh := make(chan []byte, 2)
	go sm.frameSrc.FramePump(ctx, cameraName, fps, frameCh)

	frameDuration := time.Duration(float64(time.Second) / float64(fps))
	var pts uint64

	sm.log.Info("frame pump started", "camera", cameraName, "fps", fps)

	for {
		select {
		case <-ctx.Done():
			sm.log.Info("frame pump stopped")
			return
		case jpeg, ok := <-frameCh:
			if !ok {
				return
			}

			h264Data, err := encoder.Encode(jpeg, pts)
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
	defer sm.mu.Unlock()

	if sm.pc == nil {
		sm.log.Warn("no active session for SDP answer")
		return
	}
	if sessionID != "" && sessionID != sm.sessionID {
		sm.log.Warn("ignoring SDP answer for stale session", "session_id", sessionID, "active_session_id", sm.sessionID)
		return
	}

	if sm.pc.RemoteDescription() != nil {
		sm.log.Warn("remote description already set, ignoring duplicate SDP answer")
		return
	}

	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	}
	if err := sm.pc.SetRemoteDescription(answer); err != nil {
		sm.log.Error("set remote desc failed", "error", err)
		return
	}

	for _, candidate := range sm.pendingICE {
		if err := sm.pc.AddICECandidate(candidate); err != nil {
			sm.log.Error("add buffered ICE candidate failed", "error", err)
		}
	}
	sm.pendingICE = nil
	sm.log.Info("SDP answer applied", "session_id", sm.sessionID)
}

func (sm *SessionManager) AddICECandidate(sessionID string, candidateJSON json.RawMessage) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.pc == nil {
		sm.log.Warn("no active session for ICE candidate")
		return
	}
	if sessionID != "" && sessionID != sm.sessionID {
		sm.log.Warn("ignoring ICE candidate for stale session", "session_id", sessionID, "active_session_id", sm.sessionID)
		return
	}

	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(candidateJSON, &candidate); err != nil {
		sm.log.Error("invalid ICE candidate", "error", err)
		return
	}

	sm.log.Debug(
		"remote ICE candidate received",
		"session_id", sm.sessionID,
		"camera", sm.cameraName,
		"candidate", candidateSummary(candidate),
	)

	if sm.pc.RemoteDescription() == nil {
		sm.pendingICE = append(sm.pendingICE, candidate)
		sm.log.Debug(
			"buffering ICE candidate until remote description is set",
			"session_id", sm.sessionID,
			"camera", sm.cameraName,
		)
		return
	}

	if err := sm.pc.AddICECandidate(candidate); err != nil {
		sm.log.Error("add ICE candidate failed", "error", err)
	}
}

func (sm *SessionManager) StopSession() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.stopLocked()
}

func (sm *SessionManager) stopLocked() {
	if sm.cancel != nil {
		sm.cancel()
		sm.cancel = nil
	}
	sm.clearDisconnectTimerLocked()
	if sm.pc != nil {
		sm.pc.Close()
		sm.pc = nil
		sm.log.Info("WebRTC session stopped")
	}
	sm.pendingICE = nil
	sm.sessionID = ""
	sm.cameraName = ""
}

func (sm *SessionManager) clearDisconnectTimer() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.clearDisconnectTimerLocked()
}

func (sm *SessionManager) clearDisconnectTimerLocked() {
	if sm.disconnectTimer != nil {
		sm.disconnectTimer.Stop()
		sm.disconnectTimer = nil
	}
}

func (sm *SessionManager) scheduleDisconnectTimeout(
	sessionID string,
	cameraName string,
	pc *webrtc.PeerConnection,
) {
	sm.mu.Lock()
	sm.clearDisconnectTimerLocked()
	sm.disconnectTimer = time.AfterFunc(12*time.Second, func() {
		shouldStop := false

		sm.mu.Lock()
		if sm.sessionID == sessionID && sm.pc == pc && pc.ConnectionState() == webrtc.PeerConnectionStateDisconnected {
			shouldStop = true
		}
		sm.disconnectTimer = nil
		sm.mu.Unlock()

		if !shouldStop {
			return
		}

		sm.log.Warn("peer connection did not recover before timeout", "session_id", sessionID, "camera", cameraName)
		sm.reportStatus("idle", map[string]interface{}{
			"camera":         cameraName,
			"peerConnection": webrtc.PeerConnectionStateDisconnected.String(),
			"reason":         "disconnect-timeout",
			"sessionId":      sessionID,
		})
		sm.StopSession()
	})
	sm.mu.Unlock()
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

func (sm *SessionManager) sendAck(cameraName string, sessionID string, ok bool, errMsg string) {
	payload := map[string]interface{}{
		"cameraName": cameraName,
		"ok":         ok,
		"sessionId":  sessionID,
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

	return sm.sessionID == sessionID && sm.pc == pc
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
