---
name: service-method-contract-flow
description: Add or update a JSONSchema-backed service method in TrakrAI device services, generate typed Go and Python bindings, wire the provider and caller sides, push to the emulator, and verify the end-to-end flow with devtool. Use when adding a new method to a Go binary service or a Python wheel service, or when teaching someone the manifest-to-runtime flow.
---

# Service Method Contract Flow

Use this skill when you need to add, change, or explain a device-side service method that should be type-safe across TrakrAI services.

The source of truth is `device/manifests/service-methods.json`.
Do not hand-edit generated bindings under:

- `device/internal/ipc/contracts/`
- `device/python/trakrai_service_runtime/src/generated_contracts/`

If the audience is a human developer rather than an agent, point them to:

- `device/docs/service-method-contracts-guide.md`

That guide explains the same flow in step-by-step developer language, including worked Go and Python examples, manifest field meanings, and caller-side integration patterns.

## What This Skill Covers

This skill explains the full path:

1. define or change the method contract in the manifest
2. regenerate Go and Python bindings
3. implement the provider-side handler in the target service
4. call the method from another service through generated clients
5. push the touched services to the emulator
6. verify the flow with direct runtime calls and `devtool test`

## Non-Negotiable Rules

- Keep `cloud-comm` generic. Do not encode service-specific semantics there.
- The manifest is the only contract source of truth.
- Generated bindings must be regenerated after every manifest edit.
- Provider code should consume generated request/response types.
- Caller code should use generated clients, not ad-hoc envelopes.
- Push one service at a time with `devtool service push`. In practice, repeated `--service` flags do not batch the way you might expect.

## Core Workflow

### 1. Add the contract to the manifest

Edit `device/manifests/service-methods.json`.

You usually touch three areas:

- `schemas`: request or response object definitions
- `messages`: response envelope types
- `methods`: the callable command entry

Typical method entry:

```json
{
  "name": "preview-audio",
  "subtopic": "command",
  "request": {
    "schema": "AudioRequest"
  },
  "responses": [
    {
      "message": "audio-manager-preview"
    },
    {
      "message": "audio-manager-error"
    }
  ]
}
```

Use an existing schema when the wire shape already matches the new method. Only add a new schema when the output or input is meaningfully different.

### 2. Regenerate bindings

Run:

```bash
python3 -m device.devtool contract validate
python3 -m device.devtool contract codegen --service <provider-service> --service <caller-service>
```

This updates:

- Go contracts in `device/internal/ipc/contracts/`
- Python contracts in `device/python/trakrai_service_runtime/src/generated_contracts/`

### 3. Implement the provider-side handler

The generated code creates the dispatch and client surface. You still need to implement the concrete handler inside the service.

#### Go provider pattern

Implement the new generated handler method on the service struct in the provider service, usually in `device/internal/<service>/service.go`.

Shape:

```go
func (s *Service) HandleDescribeStorage(
    ctx context.Context,
    sourceService string,
    request contracts.CloudTransferStatsRequest,
) error {
    return s.publishStatusResponse(ctx, request.RequestID)
}
```

Notes:

- Follow the generated handler name exactly.
- Use generated request types from `internal/ipc/contracts`.
- Reuse existing response helpers when possible.
- Preserve current wire behavior and error semantics.

#### Python provider pattern

Implement the generated handler method in the service class and publish generated payload types back through the bridge.

Shape:

```python
def handle_preview_audio(self, source_service: str, request: AudioManagerAudioRequest) -> None:
    self._handle_preview_audio(source_service, request)
```

Inside the worker/helper path:

- normalize the generated request into your service model if the service already has one
- compute the response
- publish the generated payload with `to_wire_value(...)`

### 4. Plug the method into another service

The caller should use the generated client for the target service.

#### Go caller pattern

In the calling service, use the generated client already attached to the service or add one.

Shape:

```go
storage, err := s.transferClient.DescribeStorage(ctx, contracts.CloudTransferStatsRequest{})
if err != nil {
    s.log.Debug("cloud-transfer describe-storage failed", "error", err)
}
```

Keep the first integration low risk. A preview, lookup, or status-style method is usually the cleanest way to prove the flow.

#### Python caller pattern

Use the generated client from `trakrai_service_runtime.generated_contracts`.

Shape:

```python
preview = audio_client.preview_audio(audio_request, timeout_sec=max(1.0, timeout_sec))
response = audio_client.play_audio(audio_request, timeout_sec=max(1.0, timeout_sec))
```

If the new method is a preparatory step, surface its value in node outputs or logs so the integration is observable.

## Demo In This Repo

This repo already has a minimal cross-language teaching demo for this flow.

### Go demo

Provider:

- service: `cloud-transfer`
- new method: `describe-storage`
- request schema reused: `StatsRequest`
- response schema reused: `cloud-transfer-status`

Files touched:

- `device/manifests/service-methods.json`
- `device/internal/cloudtransfer/service.go`
- `device/internal/ipc/contracts/cloud_transfer.go`

Caller:

- calling service: `video-recorder`
- integration point: `enqueueVideoUpload(...)`
- generated client call: `s.transferClient.DescribeStorage(...)`

Files touched:

- `device/internal/videorecorder/service.go`

Why this demo is useful:

- it shows a new Go method that reuses an existing schema
- it shows the caller using generated contracts instead of manual envelopes
- it keeps the behavior safe because it is observational before the upload enqueue

### Python demo

Provider:

- service: `audio-manager`
- new method: `preview-audio`
- request schema reused: `AudioRequest`
- new response schema: `AudioPreviewPayload`
- new response message: `audio-manager-preview`

Files touched:

- `device/manifests/service-methods.json`
- `device/python/audio_manager/src/service.py`
- `device/python/audio_manager/src/speaker.py`
- `device/python/trakrai_service_runtime/src/generated_contracts/audio_manager.py`

Caller:

- calling service: `workflow-engine`
- integration point: `play-audio-message` node
- generated client call: `audio_client.preview_audio(...)`
- surfaced outputs:
  - `previewDedupeKey`
  - `previewSpeakerPayload`

Files touched:

- `device/python/workflow_engine/src/nodes/audio_nodes.py`

Why this demo is useful:

- it shows a Python provider returning a new structured response
- it shows a Python caller using the generated client immediately
- it surfaces the preview values in workflow outputs, so verification is explicit

## Verification Workflow

### Local contract/build checks

Run:

```bash
python3 -m device.devtool contract validate
python3 -m device.devtool contract codegen --service cloud-transfer --service audio-manager --service workflow-engine --service video-recorder
python3 -m py_compile \
  device/python/audio_manager/src/service.py \
  device/python/audio_manager/src/speaker.py \
  device/python/workflow_engine/src/nodes/audio_nodes.py
cd device && go test ./internal/ipc/contracts ./internal/cloudtransfer ./internal/videorecorder
```

### Push the touched services to the emulator

Push one at a time:

```bash
python3 -m device.devtool service push --service cloud-transfer --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service video-recorder --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service audio-manager --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service workflow-engine --target emulator --config-source current --timeout-sec 90
```

### Direct runtime proof of the new methods

Use `RuntimeWsClient` or an equivalent small script.

Expected demo results:

- `cloud-transfer:describe-storage` returns `cloud-transfer-status`
- `audio-manager:preview-audio` returns `audio-manager-preview`
- a valid preview payload includes computed speaker data such as `speakerPayload: "m:901"`

### End-to-end test proof

Run:

```bash
python3 -m device.devtool test run --test-name audio-service-local --timeout-sec 240
python3 -m device.devtool test run --test-name violation-service-local --timeout-sec 300
```

What to look for:

- `audio-service-local`
  - `workflow_run.envelope.payload.run.outputs.audio.previewDedupeKey`
  - `workflow_run.envelope.payload.run.outputs.audio.previewSpeakerPayload`
- `violation-service-local`
  - the video path still completes through `video-recorder` and `cloud-transfer`
  - this proves the Go caller integration did not break the upload flow

## Troubleshooting

- If the generated Python code breaks on the emulator but not locally, check Python version compatibility first. The emulator currently runs Python 3.8.
- If a response is not seen, confirm the method was added under the correct `subtopic`.
- If the handler never fires, confirm the generated dispatcher was regenerated and the service code imports the updated generated package.
- If `devtool service push` appears to skip services, push them individually.
- If a Go demo only logs at debug level, the end-to-end test can still prove the code path is safe even if the new method result is not user-visible.

## Cleanup If The Demo Was Temporary

If the goal was only to learn the pattern, keep this skill and revert the demo edits.

Files to revert:

- `device/manifests/service-methods.json`
- `device/internal/cloudtransfer/service.go`
- `device/internal/videorecorder/service.go`
- `device/python/audio_manager/src/service.py`
- `device/python/audio_manager/src/speaker.py`
- `device/python/workflow_engine/src/nodes/audio_nodes.py`
- everything regenerated under:
  - `device/internal/ipc/contracts/`
  - `device/python/trakrai_service_runtime/src/generated_contracts/`

Example:

```bash
git restore \
  device/manifests/service-methods.json \
  device/internal/cloudtransfer/service.go \
  device/internal/videorecorder/service.go \
  device/python/audio_manager/src/service.py \
  device/python/audio_manager/src/speaker.py \
  device/python/workflow_engine/src/nodes/audio_nodes.py \
  device/internal/ipc/contracts \
  device/python/trakrai_service_runtime/src/generated_contracts
```

Keep the skill at:

- `.agents/skills/service-method-contract-flow/SKILL.md`

## Success Criteria

You are done when all of the following are true:

- the manifest defines the method and all referenced schemas/messages
- generated Go and Python bindings compile
- the provider service implements the generated handler
- at least one caller uses the generated client
- emulator pushes succeed for the touched services
- direct runtime calls return the new response types
- `devtool test` proves the surrounding flow still works
