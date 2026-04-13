package ipc

import "encoding/json"

type MQTTEnvelope struct {
	MsgID     string          `json:"msgId"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type Request struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type Response struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Notification struct {
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
