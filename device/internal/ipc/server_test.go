package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestServerRoutesLocalServiceMessage(t *testing.T) {
	socketPath := filepath.Join("/tmp", "trakrai-ipc-"+strconv.FormatInt(time.Now().UnixNano(), 10)+".sock")
	_ = os.Remove(socketPath)
	defer os.Remove(socketPath)
	server, err := NewServer(socketPath)
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go server.Serve(ctx)

	sourceConn := mustDialIPC(t, socketPath)
	defer sourceConn.Close()
	sourceReader := bufio.NewReader(sourceConn)

	targetConn := mustDialIPC(t, socketPath)
	defer targetConn.Close()
	targetReader := bufio.NewReader(targetConn)

	mustRegisterService(t, sourceConn, sourceReader, "source-service")
	mustRegisterService(t, targetConn, targetReader, "target-service")

	payload := map[string]interface{}{
		"requestId": "req-123",
		"value":     "hello",
	}
	writeFrame(t, sourceConn, Request{
		ID:     "send-1",
		Method: "send-service-message",
		Params: mustJSON(t, SendServiceMessageRequest{
			TargetService: "target-service",
			Subtopic:      "command",
			Type:          "enqueue-upload",
			Payload:       mustJSON(t, payload),
		}),
	})

	response := readResponse(t, sourceReader)
	if response.Error != nil {
		t.Fatalf("send-service-message returned error: %v", response.Error.Message)
	}

	notification := readNotification(t, targetReader)
	if notification.Method != "service-message" {
		t.Fatalf("expected service-message notification, got %q", notification.Method)
	}

	var message ServiceMessageNotification
	if err := json.Unmarshal(notification.Params, &message); err != nil {
		t.Fatalf("unmarshal ServiceMessageNotification failed: %v", err)
	}
	if message.SourceService != "source-service" {
		t.Fatalf("expected source-service source, got %q", message.SourceService)
	}
	if message.Service != "target-service" {
		t.Fatalf("expected target-service target, got %q", message.Service)
	}
	if message.Subtopic != "command" {
		t.Fatalf("expected command subtopic, got %q", message.Subtopic)
	}
	if message.Envelope.Type != "enqueue-upload" {
		t.Fatalf("expected enqueue-upload type, got %q", message.Envelope.Type)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(message.Envelope.Payload, &decoded); err != nil {
		t.Fatalf("unmarshal notification payload failed: %v", err)
	}
	if decoded["requestId"] != "req-123" {
		t.Fatalf("expected requestId req-123, got %#v", decoded["requestId"])
	}
	if decoded["value"] != "hello" {
		t.Fatalf("expected payload value hello, got %#v", decoded["value"])
	}
}

func mustDialIPC(t *testing.T, socketPath string) net.Conn {
	t.Helper()

	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("SetDeadline failed: %v", err)
	}
	return conn
}

func mustRegisterService(t *testing.T, conn net.Conn, reader *bufio.Reader, serviceName string) {
	t.Helper()

	writeFrame(t, conn, Request{
		ID:     "register-" + serviceName,
		Method: "register-service",
		Params: mustJSON(t, RegisterServiceRequest{Service: serviceName}),
	})
	response := readResponse(t, reader)
	if response.Error != nil {
		t.Fatalf("register-service returned error: %v", response.Error.Message)
	}
}

func writeFrame(t *testing.T, conn net.Conn, value interface{}) {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	if _, err := conn.Write(append(data, '\n')); err != nil {
		t.Fatalf("Write failed: %v", err)
	}
}

func readResponse(t *testing.T, reader *bufio.Reader) Response {
	t.Helper()

	line, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("ReadBytes failed: %v", err)
	}

	var response Response
	if err := json.Unmarshal(line, &response); err != nil {
		t.Fatalf("unmarshal Response failed: %v", err)
	}
	return response
}

func readNotification(t *testing.T, reader *bufio.Reader) Notification {
	t.Helper()

	line, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatalf("ReadBytes failed: %v", err)
	}

	var notification Notification
	if err := json.Unmarshal(line, &notification); err != nil {
		t.Fatalf("unmarshal Notification failed: %v", err)
	}
	return notification
}

func mustJSON(t *testing.T, value interface{}) json.RawMessage {
	t.Helper()

	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	return data
}
