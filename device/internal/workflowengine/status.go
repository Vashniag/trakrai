package workflowengine

import (
	"time"
)

type statusSnapshot struct {
	dispatchedActions int64
	executedWorkflows int64
	lastCamera        string
	lastExecutionID   string
	lastDetectionKey  string
	lastDetections    int
	lastFrameID       string
	lastActionTarget  string
	lastActionType    string
	lastError         string
	lastProcessedAt   time.Time
	lastQueueLatency  time.Duration
	lastQueueAge      time.Duration
	lastWorkflowName  string
	processedFrames   int64
	receivedFrames    int64
	staleFrames       int64
	invalidFrames     int64
	missingDetections int64
}

func (s *statusSnapshot) noteReceived(frame *QueueEnvelope) {
	s.receivedFrames++
	s.lastCamera = frame.CameraName
	s.lastFrameID = frame.FrameID
	s.lastDetectionKey = frame.DetectionsKey
	if !frame.EnqueuedAt.IsZero() {
		s.lastQueueAge = time.Since(frame.EnqueuedAt)
	}
}

func (s *statusSnapshot) noteProcessed(frame *WorkflowFrame) {
	s.processedFrames++
	s.lastCamera = frame.Envelope.CameraName
	s.lastFrameID = frame.Envelope.FrameID
	s.lastDetectionKey = frame.Envelope.DetectionsKey
	s.lastDetections = frame.Detections.TotalDetection
	s.lastProcessedAt = time.Now().UTC()
	s.lastQueueLatency = frame.QueueLatency
	s.lastError = ""
}

func (s *statusSnapshot) noteWorkflowResult(frame *WorkflowFrame, workflowName string, result *WorkflowExecutionResult) {
	s.noteProcessed(frame)
	s.executedWorkflows++
	s.lastExecutionID = result.ExecutionID
	s.lastWorkflowName = workflowName
	if !result.Success && len(result.Errors) > 0 {
		s.lastError = result.Errors[0]
	}
}

func (s *statusSnapshot) noteDispatchedAction(action WorkflowAction) {
	s.dispatchedActions++
	s.lastActionTarget = action.TargetService
	s.lastActionType = action.Type
}

func (s *statusSnapshot) noteStale(frame *QueueEnvelope) {
	s.staleFrames++
	s.noteReceived(frame)
}

func (s *statusSnapshot) noteInvalid(err error) {
	s.invalidFrames++
	s.lastError = err.Error()
}

func (s *statusSnapshot) noteMissingDetections(frame *QueueEnvelope, err error) {
	s.missingDetections++
	s.noteReceived(frame)
	s.lastError = err.Error()
}

func (s *statusSnapshot) statusDetails(queueKey string) map[string]interface{} {
	details := map[string]interface{}{
		"queue":                queueKey,
		"received_frames":      s.receivedFrames,
		"processed_frames":     s.processedFrames,
		"stale_frames":         s.staleFrames,
		"invalid_frames":       s.invalidFrames,
		"missing_detections":   s.missingDetections,
		"executed_workflows":   s.executedWorkflows,
		"dispatched_actions":   s.dispatchedActions,
		"last_camera":          s.lastCamera,
		"last_frame_id":        s.lastFrameID,
		"last_detections_key":  s.lastDetectionKey,
		"last_detection_count": s.lastDetections,
		"last_execution_id":    s.lastExecutionID,
		"last_action_target":   s.lastActionTarget,
		"last_action_type":     s.lastActionType,
		"last_workflow_name":   s.lastWorkflowName,
		"last_error":           s.lastError,
	}
	if s.lastQueueLatency > 0 {
		details["last_queue_latency_ms"] = s.lastQueueLatency.Milliseconds()
	}
	if s.lastQueueAge > 0 {
		details["last_queue_age_ms"] = s.lastQueueAge.Milliseconds()
	}
	if !s.lastProcessedAt.IsZero() {
		details["last_processed_at"] = s.lastProcessedAt.Format(time.RFC3339Nano)
	}
	return details
}
