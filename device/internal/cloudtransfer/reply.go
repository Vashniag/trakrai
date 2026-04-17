package cloudtransfer

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/trakrai/device-services/internal/ipc"
)

func DecodeServiceMessage(message ipc.ServiceMessageNotification) (Transfer, error) {
	switch strings.TrimSpace(message.Envelope.Type) {
	case cloudTransferTransferType:
		var payload TransferPayload
		if err := json.Unmarshal(message.Envelope.Payload, &payload); err != nil {
			return Transfer{}, fmt.Errorf("decode transfer payload: %w", err)
		}
		return payload.Transfer, nil
	case cloudTransferErrorType:
		var payload TransferErrorPayload
		if err := json.Unmarshal(message.Envelope.Payload, &payload); err != nil {
			return Transfer{}, fmt.Errorf("decode transfer error payload: %w", err)
		}
		return Transfer{}, fmt.Errorf("%s", payload.Error)
	default:
		return Transfer{}, fmt.Errorf("unexpected transfer response type %q", message.Envelope.Type)
	}
}
