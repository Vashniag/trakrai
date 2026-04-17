package ipc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type ResponseRouter struct {
	mu      sync.Mutex
	waiters map[string]chan ServiceMessageNotification
}

func NewResponseRouter() *ResponseRouter {
	return &ResponseRouter{
		waiters: make(map[string]chan ServiceMessageNotification),
	}
}

func (r *ResponseRouter) Dispatch(message ServiceMessageNotification) bool {
	requestID := ReadRequestID(message.Envelope.Payload)
	if requestID == "" {
		return false
	}

	r.mu.Lock()
	waiter := r.waiters[requestID]
	r.mu.Unlock()
	if waiter == nil {
		return false
	}

	select {
	case waiter <- message:
	default:
	}
	return true
}

func (r *ResponseRouter) Request(
	ctx context.Context,
	client *Client,
	targetService string,
	requestType string,
	payload interface{},
) (ServiceMessageNotification, error) {
	requestID := ReadRequestIDFromValue(payload)
	if requestID == "" {
		return ServiceMessageNotification{}, fmt.Errorf("%s request is missing requestId", requestType)
	}

	waiter := make(chan ServiceMessageNotification, 1)
	r.mu.Lock()
	r.waiters[requestID] = waiter
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.waiters, requestID)
		r.mu.Unlock()
	}()

	if err := client.SendServiceMessage(targetService, "command", requestType, payload); err != nil {
		return ServiceMessageNotification{}, fmt.Errorf("send %s to %s: %w", requestType, targetService, err)
	}

	select {
	case <-ctx.Done():
		return ServiceMessageNotification{}, ctx.Err()
	case message := <-waiter:
		if strings.TrimSpace(message.SourceService) != strings.TrimSpace(targetService) {
			return ServiceMessageNotification{}, fmt.Errorf("unexpected response source %q", message.SourceService)
		}
		return message, nil
	}
}

func ReadRequestID(payload json.RawMessage) string {
	if len(payload) == 0 {
		return ""
	}

	var decoded struct {
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return ""
	}

	return strings.TrimSpace(decoded.RequestID)
}

func ReadRequestIDFromValue(value interface{}) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return ReadRequestID(data)
}
