# Device Workflow Engine Foundation

This note captures the first architectural slice of the device-side rebuild.

## Current direction

- `ai_inference` stays inference-only.
- Device workflow execution moves into a separate `workflow-engine` process.
- `ai_inference` publishes compact workflow envelopes into Redis after inference finishes.
- `workflow-engine` consumes those envelopes from a Redis queue and becomes the future home for ROI, cloud-forwarding, and audio-alert nodes.
- Service-to-service work should use the shared IPC bus, not ad hoc Redis queues or business-specific MQTT handling.

## What landed in this pass

- Added `workflow_queue` config to `ai_inference`.
- `ai_inference` now enqueues frame/detection references into Redis key `workflow:frames` by default.
- Added a new Go service:
  - `cmd/workflow-engine`
  - `internal/workflowengine`
- Added a new Go service:
  - `cmd/audio-alert`
  - `internal/audioalert`
- `workflow-engine` currently:
  - loads config
  - connects to Redis
  - connects to IPC as `workflow-engine`
  - blocks on the Redis queue
  - validates frame envelopes
  - reports status over IPC
- `audio-alert` currently:
  - registers on IPC as `audio-alert`
  - accepts generic command envelopes
  - reports accepted command state
  - provides the dedicated process boundary for future speaker playback and talkback work
- Extended IPC with a generic `send-service-message` method and `service-message` notification so future services can talk to each other without routing everything through MQTT.
- Added `workflow-engine` to device staging/runtime config generation and to the sample runtime-manager service list.

## Important boundary rules

- `cloud-comm` remains a generic MQTT and edge transport bridge.
- `workflow-engine` owns business-node meaning such as violation or tilt.
- `transfer-manager`, `video-recorder`, and `audio-alert` should receive generic service envelopes over IPC.
- Intermediate services must not learn business packet internals.

## Next implementation steps

1. Add a dedicated workflow graph/runtime layer inside `workflow-engine`.
2. Implement MVP nodes:
   - ROI filtering
   - send violation to cloud
   - audio alert
3. Flesh out `transfer-manager` as the durable signed URL and HTTP transfer sidecar.
4. Add `audio-alert` speaker playback and WebRTC talkback execution behind the current command contracts.
5. Add `video-recorder` as a separate process for raw, bbox, and grid clip rendering.

## Queue envelope shape

Current inference enqueue payload:

```json
{
  "camera_id": 1,
  "camera_name": "Camera-1",
  "frame_id": "img-123",
  "source_cam_id": "1",
  "raw_frame_key": "camera:Camera-1:latest",
  "processed_frame_key": "camera:Camera-1:processed",
  "detections_key": "camera:Camera-1:detections",
  "enqueued_at": 1713170000.123
}
```

This keeps the queue lightweight while letting `workflow-engine` fetch the detailed payload it needs from Redis.
