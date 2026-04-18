package cloudtransfer

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/ipc/contracts"
)

func DecodeServiceMessage(message ipc.ServiceMessageNotification) (Transfer, error) {
	switch strings.TrimSpace(message.Envelope.Type) {
	case contracts.CloudTransferTransferMessage:
		var payload TransferPayload
		if err := json.Unmarshal(message.Envelope.Payload, &payload); err != nil {
			return Transfer{}, fmt.Errorf("decode transfer payload: %w", err)
		}
		return payload.Transfer, nil
	case contracts.CloudTransferErrorMessage:
		var payload TransferErrorPayload
		if err := json.Unmarshal(message.Envelope.Payload, &payload); err != nil {
			return Transfer{}, fmt.Errorf("decode transfer error payload: %w", err)
		}
		return Transfer{}, fmt.Errorf("%s", payload.Error)
	default:
		return Transfer{}, fmt.Errorf("unexpected transfer response type %q", message.Envelope.Type)
	}
}
