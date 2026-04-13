package livefeed

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

type MessagePublisher interface {
	Publish(subtopic string, msgType string, payload interface{}) error
}

type SessionManager struct {
	mu         sync.Mutex
	pc         *webrtc.PeerConnection
	cancel     context.CancelFunc
	publisher  MessagePublisher
	frameSrc   *FrameSource
	cfg        *Config
	log        *slog.Logger
	pendingICE []webrtc.ICECandidateInit
}

func NewSessionManager(cfg *Config, frameSource *FrameSource, publisher MessagePublisher) *SessionManager {
	return &SessionManager{
		cfg:       cfg,
		frameSrc:  frameSource,
		publisher: publisher,
		log:       slog.With("component", "webrtc"),
	}
}

func (sm *SessionManager) StartSession(cameraName string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.stopLocked()
	sm.log.Info("starting WebRTC session", "camera", cameraName)

	iceServers := []webrtc.ICEServer{}
	for _, stun := range sm.cfg.WebRTC.STUNServers {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: []string{stun}})
	}
	for _, turn := range sm.cfg.WebRTC.TURNServers {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:           []string{turn.URL},
			Username:       turn.Username,
			Credential:     turn.Credential,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		sm.log.Error("peer connection failed", "error", err)
		sm.sendAck(cameraName, false, err.Error())
		return
	}
	sm.pc = pc
	sm.pendingICE = nil

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
		sm.sendAck(cameraName, false, err.Error())
		return
	}

	if _, err := pc.AddTrack(videoTrack); err != nil {
		sm.log.Error("add track failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sendAck(cameraName, false, err.Error())
		return
	}

	pc.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		sm.publish("webrtc/ice", "ice-candidate", map[string]interface{}{
			"candidate": candidate.ToJSON(),
		})
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		sm.log.Info("connection state changed", "state", state.String())
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateDisconnected ||
			state == webrtc.PeerConnectionStateClosed {
			sm.StopSession()
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		sm.log.Error("create offer failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sendAck(cameraName, false, err.Error())
		return
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		sm.log.Error("set local desc failed", "error", err)
		pc.Close()
		sm.pc = nil
		sm.sendAck(cameraName, false, err.Error())
		return
	}

	gatherComplete := webrtc.GatheringCompletePromise(pc)
	sm.sendAck(cameraName, true, "")

	sessionCtx, cancel := context.WithCancel(context.Background())
	sm.cancel = cancel

	go func() {
		select {
		case <-gatherComplete:
			localDesc := pc.LocalDescription()
			sm.publish("webrtc/offer", "sdp-offer", map[string]interface{}{
				"sdp":        localDesc.SDP,
				"cameraName": cameraName,
			})
			sm.log.Info("SDP offer sent")
		case <-sessionCtx.Done():
			return
		}
	}()

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

func (sm *SessionManager) SetRemoteAnswer(sdp string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.pc == nil {
		sm.log.Warn("no active session for SDP answer")
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
	sm.log.Info("SDP answer applied")
}

func (sm *SessionManager) AddICECandidate(candidateJSON json.RawMessage) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.pc == nil {
		sm.log.Warn("no active session for ICE candidate")
		return
	}

	var candidate webrtc.ICECandidateInit
	if err := json.Unmarshal(candidateJSON, &candidate); err != nil {
		sm.log.Error("invalid ICE candidate", "error", err)
		return
	}

	if sm.pc.RemoteDescription() == nil {
		sm.pendingICE = append(sm.pendingICE, candidate)
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
	if sm.pc != nil {
		sm.pc.Close()
		sm.pc = nil
		sm.log.Info("WebRTC session stopped")
	}
	sm.pendingICE = nil
}

func (sm *SessionManager) publish(subtopic string, msgType string, payload interface{}) {
	if sm.publisher == nil {
		sm.log.Warn("publish skipped because message publisher is not configured", "subtopic", subtopic, "type", msgType)
		return
	}
	if err := sm.publisher.Publish(subtopic, msgType, payload); err != nil {
		sm.log.Warn("publish failed", "subtopic", subtopic, "type", msgType, "error", err)
	}
}

func (sm *SessionManager) sendAck(cameraName string, ok bool, errMsg string) {
	payload := map[string]interface{}{
		"cameraName": cameraName,
		"ok":         ok,
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	sm.publish("response", "start-live-ack", payload)
}
