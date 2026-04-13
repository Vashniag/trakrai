package main

import "encoding/json"

// MQTTEnvelope is the standard message format exchanged over MQTT.
type MQTTEnvelope struct {
	MsgID     string          `json:"msgId"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// IPCRequest is a JSON-RPC-like request from a sub-service to the router.
type IPCRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// IPCResponse is the response sent back to the sub-service.
type IPCResponse struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *IPCError       `json:"error,omitempty"`
}

// IPCError represents an error in an IPC response.
type IPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// IPCNotification is a notification pushed from cloud-comm to a sub-service.
type IPCNotification struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type StatusReport struct {
	Service string                 `json:"service"`
	Status  string                 `json:"status"`
	Details map[string]interface{} `json:"details,omitempty"`
}

type ErrorReport struct {
	Service string `json:"service"`
	Error   string `json:"error"`
	Fatal   bool   `json:"fatal"`
}

type RegisterServiceRequest struct {
	Service string `json:"service"`
}

type PublishMessageRequest struct {
	Service  string          `json:"service,omitempty"`
	Subtopic string          `json:"subtopic"`
	Type     string          `json:"type"`
	Payload  json.RawMessage `json:"payload"`
}

type MqttMessageNotification struct {
	Service  string       `json:"service"`
	Subtopic string       `json:"subtopic"`
	Envelope MQTTEnvelope `json:"envelope"`
}
