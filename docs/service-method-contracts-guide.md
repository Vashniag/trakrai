# Adding Device Service Methods With Generated Contracts

Step-by-step guide for human developers who need to add or change a TrakrAI device service method and make it callable safely from other services.

Validation basis for this guide:

- manifest review in `device/manifests/service-methods.json`
- contract CLI review in `device/devtool/contracts.py`
- generated binding review in:
  - `device/internal/ipc/contracts/`
  - `device/python/trakrai_service_runtime/src/generated_contracts/`
- provider and caller pattern review in:
  - `device/internal/cloudtransfer/service.go`
  - `device/internal/videorecorder/service.go`
  - `device/python/audio_manager/src/service.py`
  - `device/python/audio_manager/src/speaker.py`
  - `device/python/workflow_engine/src/nodes/audio_nodes.py`

This document is intentionally explicit. It explains:

1. where each change goes
2. what each manifest section means
3. how generated names are derived
4. how to implement the provider side
5. how to call the method from another service
6. how to verify the flow correctly

## 1. What Problem This Solves

TrakrAI device services communicate through a shared IPC/message flow.

Without a central contract:

- one service can silently change a request shape
- callers may keep sending the old shape
- the compiler and IDE do not help you catch the mismatch

The fix is:

- define service methods once in `device/manifests/service-methods.json`
- generate language-specific bindings from that manifest
- use the generated request/response/client/dispatch code in services

That gives you:

- autocomplete on request and response types
- compile-time feedback in Go
- IDE feedback in Python for generated dataclasses and client methods
- one source of truth for message shapes

## 2. The End-To-End Flow

The contract flow has four layers:

1. Manifest
   - file: `device/manifests/service-methods.json`
   - this is the source of truth
2. Generated bindings
   - Go: `device/internal/ipc/contracts/`
   - Python: `device/python/trakrai_service_runtime/src/generated_contracts/`
3. Provider implementation
   - the service that receives the command and returns the response
4. Caller implementation
   - the service that invokes the generated client method

The rule is simple:

- humans edit the manifest and service code
- humans do not hand-edit generated bindings

## 3. Files You Need To Know

| Path | What it is |
| --- | --- |
| `device/manifests/service-methods.json` | service method manifest |
| `device/devtool/contracts.py` | CLI entrypoint for validate/codegen |
| `device/internal/ipc/contracts/` | generated Go contracts |
| `device/python/trakrai_service_runtime/src/generated_contracts/` | generated Python contracts |
| `device/internal/<service>/service.go` | Go provider or caller implementation |
| `device/python/<service>/src/service.py` | Python provider implementation |
| `device/python/<service>/src/...` | Python helpers the provider may reuse |

## 4. How The Manifest Is Structured

Inside `device/manifests/service-methods.json`, each service entry has three main contract sections:

- `schemas`
- `messages`
- `methods`

### 4.1 `schemas`

`schemas` define reusable JSON objects.

Typical uses:

- request payloads
- response payloads
- nested data objects

Example shape:

```json
"StatusRequest": {
  "type": "object",
  "properties": {
    "requestId": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

What the important fields mean:

- `type: "object"`: this schema is a JSON object
- `properties`: the allowed keys
- `required`: fields that must be present
- `additionalProperties: false`: reject unknown keys

Use `additionalProperties: false` for normal request and response objects unless you explicitly need a free-form map.

### 4.2 `messages`

`messages` define named response envelope payload types.

The service method itself does not directly point to a response schema. It points to a response message name, and that message points to the schema.

Example shape:

```json
"messages": [
  {
    "type": "audio-manager-preview",
    "schema": "AudioPreviewPayload"
  }
]
```

What the fields mean:

- `type`: the wire message type sent back over IPC
- `schema`: which schema defines the payload body

### 4.3 `methods`

`methods` define callable service commands.

Example shape:

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

What the fields mean:

- `name`: the command name callers send
- `subtopic`: normally `"command"` for service RPC-like calls
- `request.schema`: which request payload schema the method accepts
- `responses[].message`: which response message types are valid for this method

For a normal request/response method, always include the normal success message and the service error message if the service already uses one.

## 5. How Names Turn Into Generated Code

The generator derives names consistently from the service name, method name, and schema names.

### 5.1 Go naming

Example source names:

- service: `cloud-transfer`
- method: `get-status`
- schema: `StatsRequest`
- message: `cloud-transfer-status`

Generated names:

- service constant: `CloudTransferService`
- client type: `CloudTransferClient`
- request type: `CloudTransferStatsRequest`
- payload type: `CloudTransferTransferStatusPayload`
- method constant: `CloudTransferGetStatusMethod`
- client method: `GetStatus(...)`
- handler interface method: `HandleGetStatus(...)`

### 5.2 Python naming

Example source names:

- service: `audio-manager`
- method: `play-audio`
- schema: `AudioRequest`
- message: `audio-manager-job`

Generated names:

- service constant: `AUDIO_MANAGER_SERVICE`
- client class: `AudioManagerClient`
- request dataclass: `AudioManagerAudioRequest`
- payload dataclass: `AudioManagerAudioJobPayload`
- method constant: `AUDIO_MANAGER_PLAY_AUDIO_METHOD`
- client method: `play_audio(...)`
- handler protocol method: `handle_play_audio(...)`

## 6. Before You Add A Method

Before writing anything, decide these four things:

1. Which service provides the new method?
2. Which service will call it?
3. Can you reuse an existing schema?
4. What is the smallest useful success response?

Good first methods are:

- status-like lookups
- previews
- read-only helpers
- low-risk wrappers around existing provider logic

They are easier to verify and less likely to break the rest of the runtime.

## 7. Step-By-Step: Add A New Method

This is the general workflow. The worked examples later show the exact concrete edits.

### Step 1: Find the provider service section in the manifest

Open:

- `device/manifests/service-methods.json`

Find the matching service entry:

- `"name": "cloud-transfer"`
- `"name": "audio-manager"`
- or whichever service you are changing

Stay inside that service entry while editing `schemas`, `messages`, and `methods`.

### Step 2: Decide whether to reuse or add schemas

Reuse a schema if the request or response shape already exists.

Add a new schema if:

- the output shape is meaningfully different
- the request shape is not already represented cleanly

Examples:

- `describe-storage` can reuse `StatsRequest` because it only needs `requestId`
- `preview-audio` needs a new response schema because `AudioJobPayload` is not a preview

### Step 3: Add the response message

If your method needs a new success payload, add a new message under the service’s `messages` list.

If the service already has a standard error message, reuse it rather than inventing a second error shape.

### Step 4: Add the method entry

Add the new method under the service’s `methods` list.

At minimum:

- set the new method name
- keep `subtopic` as `"command"`
- point `request.schema` to the correct schema
- list every valid response message

### Step 5: Validate the manifest

Run:

```bash
python3 -m device.devtool contract validate
```

If it fails, fix the manifest before doing anything else.

### Step 6: Regenerate bindings

Run:

```bash
python3 -m device.devtool contract codegen --service <provider-service> --service <caller-service>
```

Example:

```bash
python3 -m device.devtool contract codegen --service cloud-transfer --service video-recorder
python3 -m device.devtool contract codegen --service audio-manager --service workflow-engine
```

What this does:

- updates Go bindings for those services in `device/internal/ipc/contracts/`
- updates Python bindings for those services in `device/python/trakrai_service_runtime/src/generated_contracts/`

### Step 7: Read the generated names

After codegen, inspect the generated file once.

That tells you the exact names you must implement and call.

Typical things to look for:

- the new client method name
- the new generated request type
- the new generated payload type
- the new handler name

### Step 8: Implement the provider side

#### Go provider

In:

- `device/internal/<provider-service>/service.go`

Implement the generated handler method exactly as generated.

Pattern:

```go
func (s *Service) HandleGetStatus(
    ctx context.Context,
    sourceService string,
    request contracts.CloudTransferStatsRequest,
) error {
    return s.publishStatusResponse(ctx, request.RequestId)
}
```

Important:

- the signature must match the generated interface
- use the generated request struct
- return existing provider helper results where possible

#### Python provider

In:

- `device/python/<provider-service>/src/service.py`

Implement the generated handler method exactly as generated.

Pattern:

```python
def handle_get_status(self, source_service: str, request: AudioManagerStatusRequest) -> None:
    self._publish_reply(
        source_service,
        STATUS_MESSAGE_TYPE,
        self._build_status_payload(request_id=request.request_id or ""),
    )
```

Important:

- the handler name must match the generated protocol/dispatcher
- use the generated request dataclass
- publish a generated payload shape back through the existing bridge

### Step 9: Implement or reuse helper logic

If the provider needs new internal logic, add it in the normal service code, not in generated files.

Examples:

- a Go service may reuse an existing `publishStatusResponse(...)`
- a Python service may add a helper such as `SpeakerClient.preview(...)`

### Step 10: Call the method from another service

Do not construct raw envelopes manually.

Use the generated client.

#### Go caller pattern

```go
response, err := s.transferClient.GetStatus(
    ctx,
    contracts.CloudTransferStatsRequest{
        RequestId: fmt.Sprintf("video-status-%s", uuid.NewString()),
    },
)
if err != nil {
    return err
}
```

#### Python caller pattern

```python
response = audio_client.play_audio(
    AudioManagerAudioRequest(
        camera_id="1",
        text="hello",
        play_local=True,
    ),
    timeout_sec=5.0,
)
```

### Step 11: Verify locally

Run the relevant checks.

Common ones:

```bash
python3 -m device.devtool contract validate
python3 -m device.devtool contract codegen --service <provider> --service <caller>
python3 -m py_compile device/python/<provider>/src/service.py device/python/<caller>/src/...py
cd device && go test ./internal/ipc/contracts ./internal/<provider> ./internal/<caller>
```

### Step 12: Push the touched services to the emulator

Push each service separately.

Example:

```bash
python3 -m device.devtool service push --service cloud-transfer --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service video-recorder --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service audio-manager --target emulator --config-source current --timeout-sec 90
python3 -m device.devtool service push --service workflow-engine --target emulator --config-source current --timeout-sec 90
```

Do not assume repeated `--service` flags batch multiple services in one invocation.

### Step 13: Verify the live flow

Use a mix of:

- direct runtime calls
- `devtool test`
- logs if the new call is observational only

## 8. Worked Example A: Go Provider And Go Caller

This example shows a temporary teaching method that was added and then reverted.

### Goal

Add a new method:

- provider: `cloud-transfer`
- new method: `describe-storage`
- caller: `video-recorder`

The intent was to expose current transfer storage/status information and prove the service-to-service call path.

### 8.1 Manifest changes

Provider service section:

- `cloud-transfer`

The request reused the existing `StatsRequest` schema.
The response reused the existing `cloud-transfer-status` message.

Method entry:

```json
{
  "name": "describe-storage",
  "subtopic": "command",
  "request": {
    "schema": "StatsRequest"
  },
  "responses": [
    {
      "message": "cloud-transfer-status"
    },
    {
      "message": "cloud-transfer-error"
    }
  ]
}
```

What each field means:

- `name`: callers send `describe-storage`
- `subtopic`: this is a normal command method
- `request.schema`: same request shape as `get-status`
- `responses[0]`: success returns the existing status payload
- `responses[1]`: error returns the normal cloud-transfer error shape

### 8.2 Generated Go output

After codegen, the important generated names would be:

- constant: `CloudTransferDescribeStorageMethod`
- client method: `DescribeStorage(...)`
- handler interface method: `HandleDescribeStorage(...)`
- request type: `CloudTransferStatsRequest`
- success payload type: `CloudTransferTransferStatusPayload`

### 8.3 Provider implementation in Go

File to edit:

- `device/internal/cloudtransfer/service.go`

Implementation:

```go
func (s *Service) HandleDescribeStorage(
    ctx context.Context,
    sourceService string,
    request contracts.CloudTransferStatsRequest,
) error {
    return s.publishStatusResponse(ctx, request.RequestId)
}
```

Why this is the right implementation:

- the request shape is the same as `get-status`
- the response shape is the same as `cloud-transfer-status`
- the provider already has the helper that knows how to publish that payload

### 8.4 Caller implementation in Go

File to edit:

- `device/internal/videorecorder/service.go`

Where to call it:

- near the upload enqueue flow
- the demo used `enqueueVideoUpload(...)`

Call pattern:

```go
storage, err := s.transferClient.DescribeStorage(
    ctx,
    contracts.CloudTransferStatsRequest{
        RequestId: fmt.Sprintf("video-describe-storage-%s", uuid.NewString()),
    },
)
if err != nil {
    s.log.Debug("cloud-transfer describe-storage failed", "job_id", job.ID, "worker", workerID, "error", err)
} else {
    s.log.Debug(
        "cloud-transfer describe-storage",
        "job_id", job.ID,
        "worker", workerID,
        "device_id", storage.DeviceId,
        "shared_dir", storage.SharedDir,
        "database_path", storage.DatabasePath,
    )
}
```

Why call it this way:

- it uses the generated client, not a raw message envelope
- it uses the generated request type
- it handles error explicitly
- it makes the result visible in logs without changing the main upload behavior

## 9. Worked Example B: Python Provider And Python Caller

This example also came from the temporary teaching demo and was later reverted.

### Goal

Add a new method:

- provider: `audio-manager`
- new method: `preview-audio`
- caller: `workflow-engine`

The intent was to compute what would happen before the actual `play-audio` call:

- dedupe key
- speaker payload
- speaker transport

### 9.1 Manifest changes

Provider service section:

- `audio-manager`

This example added a new response schema because a preview is not the same thing as a queued audio job.

Schema:

```json
"AudioPreviewPayload": {
  "type": "object",
  "properties": {
    "dedupeKey": { "type": "string" },
    "language": { "type": "string" },
    "playLocal": { "type": "boolean" },
    "playSpeaker": { "type": "boolean" },
    "requestId": { "type": "string" },
    "speakerAddress": { "type": "string" },
    "speakerPayload": { "type": "string" },
    "speakerTransport": { "type": "string" },
    "text": { "type": "string" }
  },
  "required": [
    "dedupeKey",
    "language",
    "playLocal",
    "playSpeaker",
    "speakerAddress",
    "speakerPayload",
    "speakerTransport",
    "text"
  ],
  "additionalProperties": false
}
```

Message:

```json
{
  "type": "audio-manager-preview",
  "schema": "AudioPreviewPayload"
}
```

Method:

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

Why this shape is correct:

- request is the same as `play-audio`, so `AudioRequest` is reused
- response is different from both `audio-manager-job` and `audio-manager-status`, so a new payload is needed
- the service’s standard error message is reused

### 9.2 Generated Python output

After codegen, the important generated names would be:

- dataclass: `AudioManagerAudioPreviewPayload`
- client method: `preview_audio(...)`
- handler method: `handle_preview_audio(...)`
- request dataclass: `AudioManagerAudioRequest`
- message constant: `AUDIO_MANAGER_PREVIEW_MESSAGE`

### 9.3 Provider helper implementation in Python

File to edit:

- `device/python/audio_manager/src/speaker.py`

The demo added a preview helper so the provider could compute speaker output without actually sending it.

Pattern:

```python
@dataclass(frozen=True)
class SpeakerPreview:
    address: str
    payload_text: str
    transport: str

def preview(self, request: AudioRequest) -> SpeakerPreview:
    ...
    return SpeakerPreview(address=address, payload_text=payload_text, transport=transport)
```

Why this matters:

- preview logic and delivery logic stay aligned
- the provider can expose a pure preview method without duplicating transport formatting logic

### 9.4 Provider implementation in Python

File to edit:

- `device/python/audio_manager/src/service.py`

Representative implementation:

```python
def handle_preview_audio(self, source_service: str, request: AudioManagerAudioRequest) -> None:
    payload = to_wire_value(request)
    try:
        parsed_request = parse_audio_request(
            payload,
            default_language=self._config.tts.default_language,
            default_speaker_address=self._config.speaker.default_address,
        )
        preview = self._speaker.preview(parsed_request)
    except ValueError as exc:
        self._publish_error(
            source_service,
            request_id=str(payload.get("requestId", "")).strip(),
            request_type="preview-audio",
            error=str(exc),
        )
        return

    self._publish_reply(
        source_service,
        "audio-manager-preview",
        to_wire_value(
            AudioManagerAudioPreviewPayload(
                dedupe_key=parsed_request.dedupe_key,
                language=parsed_request.language,
                play_local=parsed_request.play_local,
                play_speaker=parsed_request.play_speaker,
                request_id=parsed_request.request_id,
                speaker_address=preview.address,
                speaker_payload=preview.payload_text,
                speaker_transport=preview.transport,
                text=parsed_request.text,
            )
        ),
    )
```

What each piece does:

- `to_wire_value(request)`: converts the generated dataclass to a normal dict
- `parse_audio_request(...)`: reuses the service’s normal validation/defaulting logic
- `self._speaker.preview(...)`: computes the preview without side effects
- `AudioManagerAudioPreviewPayload(...)`: uses the generated response dataclass
- `self._publish_reply(...)`: sends the wire response back through the normal bridge

### 9.5 Caller implementation in Python

File to edit:

- `device/python/workflow_engine/src/nodes/audio_nodes.py`

The demo updated the `play-audio-message` node to preview first and then queue playback.

Pattern:

```python
audio_request = AudioManagerAudioRequest(
    camera_id=string_value(inputs.get("cameraId")) or detection_metadata["cameraId"],
    camera_name=detection_metadata["cameraName"],
    dedupe_key=string_value(inputs.get("dedupeKey")) or None,
    language=string_value(inputs.get("language")) or "en",
    message=string_value(inputs.get("message")),
    play_local=bool_value(inputs.get("playLocal"), default=True),
    play_speaker=bool_value(inputs.get("playSpeaker"), default=False),
    speaker_address=string_value(inputs.get("speakerAddress")) or None,
    speaker_code=string_value(inputs.get("speakerCode")) or None,
    speaker_message_id=string_value(inputs.get("speakerMessageId")) or None,
    text=string_value(inputs.get("message")),
)

preview = audio_client.preview_audio(audio_request, timeout_sec=max(1.0, timeout_sec))
response = audio_client.play_audio(audio_request, timeout_sec=max(1.0, timeout_sec))
```

Then the node returned extra outputs:

```python
return {
    "queued": ...,
    "state": ...,
    "jobId": ...,
    "previewDedupeKey": preview.dedupe_key.strip(),
    "previewSpeakerPayload": preview.speaker_payload.strip(),
}
```

Why this is the correct caller pattern:

- it creates the request once
- it uses the generated client twice with the same request object
- it makes the preview result observable to the workflow caller

## 10. How To Call Services Properly

This is the part that matters most if you want IDE help and consistent behavior.

### Always use generated clients

Correct:

- Go: `contracts.CloudTransferClient`
- Python: `AudioManagerClient`

Avoid:

- hand-written envelope JSON
- stringly-typed payload dictionaries passed around between services
- copying old request shapes from logs

### Always use generated request types

Correct:

- Go: `contracts.CloudTransferEnqueueUploadRequest{...}`
- Python: `AudioManagerAudioRequest(...)`

Avoid:

- raw `map[string]any` in Go
- raw `dict[str, Any]` in Python unless you are still inside the provider and intentionally converting to the service’s internal model

### Set `requestId` when the type allows it

`requestId` is helpful for:

- tracing requests in logs
- correlating responses
- debugging timeouts

If your generated request type includes `requestId`, populate it.

### Reuse internal validation/defaulting code

If the provider already has a normal request parser or normalizer, reuse it.

That avoids drift between:

- the old method
- the new method

### Return the smallest useful response

Do not return giant payloads just because the method can.

A good response:

- is enough for the caller to do its next step
- is easy to verify in tests
- is stable over time

## 11. Verification Checklist

### 11.1 Contract checks

```bash
python3 -m device.devtool contract validate
python3 -m device.devtool contract codegen --service <provider> --service <caller>
```

### 11.2 Language checks

For Python:

```bash
python3 -m py_compile device/python/<provider>/src/service.py device/python/<caller>/src/...py
```

For Go:

```bash
cd device && go test ./internal/ipc/contracts ./internal/<provider> ./internal/<caller>
```

### 11.3 Emulator push

Push each touched service:

```bash
python3 -m device.devtool service push --service <service> --target emulator --config-source current --timeout-sec 90
```

### 11.4 Direct runtime proof

Use a runtime request or a tiny script to call the new method directly.

You want to prove:

- the provider accepts the new request
- the new response message type is actually returned

### 11.5 End-to-end proof

Run the relevant reusable tests if your flow touches those services.

Current useful examples in this repo:

```bash
python3 -m device.devtool test run --test-name audio-service-local --timeout-sec 240
python3 -m device.devtool test run --test-name violation-service-local --timeout-sec 300
python3 -m device.devtool test run --test-name cloud-transfer-local --timeout-sec 240
```

## 12. Common Mistakes

- Editing generated files by hand
  - they will be overwritten on the next codegen run
- Adding a method but forgetting to add a response message
  - the generator needs the full method-to-message mapping
- Using a new schema where an existing one would do
  - this creates unnecessary types and more maintenance
- Forgetting the provider handler implementation
  - codegen creates the interface and dispatcher, not the business logic
- Manually building request envelopes in the caller
  - this defeats the point of typed contracts
- Pushing multiple services in one `service push` command and assuming all were applied
  - push services individually
- Verifying only the direct method and not the caller flow
  - you need both

## 13. If The Example Was Temporary

The temporary demo used to teach this workflow should be reverted after the developer understands the pattern, unless the feature is meant to stay.

Typical cleanup targets:

- the method entry in `device/manifests/service-methods.json`
- any temporary response schema/message
- provider-side handler implementation
- caller-side example invocation
- generated bindings after rerunning codegen or restoring the old state

Keep the documentation even if the demo code is reverted.

## 14. Quick Reference

Minimal sequence:

```bash
# 1. edit the manifest
$EDITOR device/manifests/service-methods.json

# 2. validate and regenerate
python3 -m device.devtool contract validate
python3 -m device.devtool contract codegen --service <provider> --service <caller>

# 3. implement provider and caller
$EDITOR device/internal/<provider>/service.go
$EDITOR device/internal/<caller>/service.go
# or
$EDITOR device/python/<provider>/src/service.py
$EDITOR device/python/<caller>/src/...py

# 4. run local checks
python3 -m py_compile ...
cd device && go test ...

# 5. push each touched service
python3 -m device.devtool service push --service <service> --target emulator --config-source current --timeout-sec 90

# 6. verify the flow
python3 -m device.devtool test run --test-name <relevant-test> --timeout-sec 240
```

If you follow that order, the IDE, generator, runtime, and tests all agree on the same service contract.
