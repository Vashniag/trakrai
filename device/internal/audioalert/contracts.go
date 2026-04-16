package audioalert

import (
	"fmt"
	"strings"
	"time"
)

const (
	CommandPlayAlert     = "play-alert"
	CommandStopAlert     = "stop-alert"
	CommandStartTalkback = "start-talkback"
	CommandStopTalkback  = "stop-talkback"
	CommandSetVolume     = "set-volume"
)

type ReplyTarget struct {
	Service  string `json:"service"`
	Subtopic string `json:"subtopic"`
}

type Command struct {
	RequestID string                 `json:"request_id,omitempty"`
	SessionID string                 `json:"session_id,omitempty"`
	Message   string                 `json:"message,omitempty"`
	Speaker   string                 `json:"speaker,omitempty"`
	Volume    int                    `json:"volume,omitempty"`
	Priority  string                 `json:"priority,omitempty"`
	ReplyTo   *ReplyTarget           `json:"reply_to,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

type alertRequest struct {
	EnqueuedAt time.Time
	FinishAt   time.Time
	Message    string
	Priority   string
	RequestID  string
	Speaker    string
	StartedAt  time.Time
	Volume     int
}

type talkbackSession struct {
	Metadata  map[string]interface{}
	SessionID string
	StartedAt time.Time
	State     string
	Transport string
}

type state struct {
	ActiveAlert            *alertRequest
	ActiveTalkbacks        map[string]talkbackSession
	CompletedAlerts        int
	CurrentVolume          int
	LastCommand            string
	LastCompletedRequestID string
	LastRequestID          string
	LastUpdatedAt          string
	PendingAlerts          []alertRequest
}

func normalizeCommand(commandType string, command Command, cfg *Config) (Command, error) {
	commandType = strings.TrimSpace(commandType)
	if commandType == "" {
		return Command{}, fmt.Errorf("command type is required")
	}

	switch commandType {
	case CommandPlayAlert, CommandStopAlert, CommandStartTalkback, CommandStopTalkback, CommandSetVolume:
	default:
		return Command{}, fmt.Errorf("unknown audio-alert command: %s", commandType)
	}

	if strings.TrimSpace(command.RequestID) == "" {
		command.RequestID = fmt.Sprintf("audio-%d", time.Now().UnixNano())
	}

	command.SessionID = strings.TrimSpace(command.SessionID)
	command.Message = strings.TrimSpace(command.Message)
	command.Speaker = strings.TrimSpace(command.Speaker)
	command.Priority = strings.TrimSpace(command.Priority)
	if command.Priority == "" {
		command.Priority = "normal"
	}
	if command.Metadata == nil {
		command.Metadata = make(map[string]interface{})
	}

	if command.Volume <= 0 {
		command.Volume = cfg.Playback.DefaultVolume
	}
	if command.Volume < 0 || command.Volume > 100 {
		return Command{}, fmt.Errorf("volume must be between 0 and 100")
	}

	switch commandType {
	case CommandPlayAlert:
		if strings.TrimSpace(command.Message) == "" {
			return Command{}, fmt.Errorf("message is required for play-alert")
		}
	case CommandStartTalkback, CommandStopTalkback:
		if command.SessionID == "" {
			return Command{}, fmt.Errorf("session_id is required for talkback commands")
		}
	}

	if command.ReplyTo != nil {
		command.ReplyTo.Service = strings.TrimSpace(command.ReplyTo.Service)
		command.ReplyTo.Subtopic = strings.TrimSpace(command.ReplyTo.Subtopic)
		if command.ReplyTo.Service == "" || command.ReplyTo.Subtopic == "" {
			return Command{}, fmt.Errorf("reply_to.service and reply_to.subtopic are required when reply_to is set")
		}
	}

	return command, nil
}
