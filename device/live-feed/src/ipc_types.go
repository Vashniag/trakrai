package main

import "encoding/json"

type MQTTEnvelope struct {
	MsgID     string          `json:"msgId"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type IPCRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type IPCResponse struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *IPCError       `json:"error,omitempty"`
}

type IPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type IPCNotification struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
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

type MqttMessageNotification struct {
	Service  string       `json:"service"`
	Subtopic string       `json:"subtopic"`
	Envelope MQTTEnvelope `json:"envelope"`
}
