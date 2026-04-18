# Device Devtool Instructions

This document is the detailed operator and developer reference for the manifest-driven device CLI:

```bash
python3 -m device.devtool ...
```

Validation basis for this document:

- parser and implementation review under `device/devtool/`
- manifest review under `device/manifests/`
- live command execution in this workspace on April 18, 2026

This guide is intentionally explicit. It covers the full currently supported command tree, the request-file shape for every request-aware command, the interactive behaviors, and the command flows that were actually verified.

## Scope And Ground Rules

- Run commands from the repo root: `trakrai/`
- The CLI is a developer/operator tool. It is meant to run on a developer machine or in CI, not directly on the target device runtime.
- The manifests are the source of truth for:
  - services
  - emulator components
  - profiles
  - test workflows
- JSON Schema files under `device/config-schemas/services/` are the source of truth for service config structure.
- Generated config bindings are emitted only for the languages each service declares:
  - Go bindings under `device/internal/generatedconfig/`
  - Python bindings under `device/python/generated_configs/`
- Generated service-contract bindings are emitted from `device/manifests/service-methods.json`:
  - Go bindings under `device/internal/ipc/contracts/`
  - Python bindings under `device/python/trakrai_service_runtime/src/generated_contracts/`
  - TypeScript bindings under `web/packages/trakrai-live-transport/src/generated-contracts/`

## Full Command Tree

The current command tree is:

```text
python3 -m device.devtool
  manifest
    list services
    list components
    list profiles
    list tests
    validate
  build
    all
    service
  completion
    bash
    zsh
    fish
  generate
    config
    contract
  config
    generate
    validate
    scaffold-schemas
    codegen
  contract
    validate
    codegen
  deploy
    ssh
  emulator
    up
    down
    status
    logs
  package
    plan
    release
    pull
    list
  runtime
    status
    start
    stop
    restart
    logs
    definition
    config-list
    config-get
    config-set
    put-file
    update-service
    upsert-service
    remove-service
  service
    push
  test
    list
    run
    feed-workflow
```

## Current Manifest Inventory

Current services:

- `cloud-comm`
- `runtime-manager`
- `edge-ui`
- `cloud-transfer`
- `live-feed`
- `ptz-control`
- `roi-config`
- `rtsp-feeder`
- `video-recorder`
- `audio-manager`
- `workflow-engine`
- `trakrai-ai-inference`

Current emulator components:

- `redis`
- `minio`
- `cloud-api`
- `mock-speaker`
- `fake-camera`
- `device-emulator`
- `host-audio-player`

Current profiles:

- `local-emulator-all`
- `local-emulator-cloud`
- `local-emulator-core`

Current reusable test workflows:

- `audio-service-local`
- `cloud-transfer-local`
- `violation-service-local`

To re-list these from the CLI:

```bash
python3 -m device.devtool manifest list services
python3 -m device.devtool manifest list components
python3 -m device.devtool manifest list profiles
python3 -m device.devtool manifest list tests
```

## Request Files

Most mutating or workflow-style commands accept `--request <path-to-json>`.

Request files are plain JSON objects. The keys match the argparse destination names in snake_case.

Rules:

- use strings for string flags
- use integers for integer flags
- use booleans for boolean flags
- use arrays for repeated flags such as `service`, `component`, `package`, and `restart_service`
- request-file values are applied after CLI parsing and can fully replace values from the command line
- commands that used to require dummy CLI values now accept request-file-only execution for the required fields that were fixed in this pass

Examples:

```json
{
  "profile": "local-emulator-all",
  "camera_count": 2,
  "cloud_mode": "local",
  "device_id": "trakrai-device-local"
}
```

```json
{
  "service": [
    "cloud-comm",
    "runtime-manager",
    "edge-ui"
  ],
  "component": [
    "device-emulator",
    "cloud-api"
  ]
}
```

```json
{
  "restart_service": [
    "cloud-comm"
  ]
}
```

## Verification Labels Used In This Document

- `Verified end-to-end`: command path was executed successfully in this workspace
- `Verified structurally`: parser and command path were exercised, but the external environment prevented a complete run
- `Not exercised in this environment`: supported by code, but not run in this pass

## Command Reference

### `manifest`

Purpose:

- inspect the current central manifest state
- validate manifest references and generated-config language declarations

#### `manifest list services`

Command:

```bash
python3 -m device.devtool manifest list services
```

Output:

- JSON array of services with `name`, `configName`, `description`, and `kind`

Verification:

- `Verified end-to-end`

#### `manifest list components`

Command:

```bash
python3 -m device.devtool manifest list components
```

Output:

- JSON array of local emulator components with `name`, `description`, and `kind`

Verification:

- `Verified end-to-end`

#### `manifest list profiles`

Command:

```bash
python3 -m device.devtool manifest list profiles
```

Output:

- JSON array of profiles with `name`, `target`, and `services`

Verification:

- `Verified end-to-end`

#### `manifest list tests`

Command:

```bash
python3 -m device.devtool manifest list tests
```

Output:

- JSON array of test workflows with `name`, `profile`, and `description`

Verification:

- `Verified end-to-end`

#### `manifest validate`

Command:

```bash
python3 -m device.devtool manifest validate
```

What it checks:

- missing schema files
- missing sample configs
- invalid service config-language declarations
- missing profile base config dirs
- unknown profile service references
- unknown profile component references
- unknown test profile references

Output:

- JSON object with `issues`

Verification:

- `Verified end-to-end`

### `build`

Purpose:

- build service artifacts locally for staging, packaging, emulator use, or CI

#### `build all`

Command shape:

```bash
python3 -m device.devtool build all [--platform <platform>]
```

Flags:

- `--platform`
  - default: manifest/device default ARM64 platform tag

What it does:

- resolves all known services
- builds every service and bundle
- prints a JSON map of built artifact paths

Verified command:

```bash
python3 -m device.devtool build all
```

Verification:

- `Verified end-to-end`

Observed built set in this environment:

- `cloud-comm`
- `runtime-manager`
- `edge-ui`
- `cloud-transfer`
- `live-feed`
- `ptz-control`
- `roi-config`
- `rtsp-feeder`
- `video-recorder`
- `audio-manager`
- `workflow-engine`
- `trakrai-ai-inference`

#### `build service`

Command shape:

```bash
python3 -m device.devtool build service --service <name> [--service <name> ...] [--platform <platform>]
```

Flags:

- `--service`
  - repeatable
  - required in practice
- `--platform`

What it does:

- builds only the named services
- prints a JSON map of built artifact paths

Verified command:

```bash
python3 -m device.devtool build service --service runtime-manager --service audio-manager
```

Verification:

- `Verified end-to-end`

### `completion`

Purpose:

- emit shell completion scripts

Commands:

```bash
python3 -m device.devtool completion bash
python3 -m device.devtool completion zsh
python3 -m device.devtool completion fish
```

What it does:

- prints the completion script to stdout for the selected shell

How to use it:

- source it directly in the shell
- or write it to a completion file managed by your shell configuration

Verification:

- `bash`: `Verified end-to-end`
- `zsh`: `Verified end-to-end`
- `fish`: `Verified end-to-end`

### `config`

Purpose:

- generate config files from profiles and schema defaults
- validate generated configs
- scaffold new schemas
- generate typed config bindings

#### `config generate`

Command shape:

```bash
python3 -m device.devtool config generate \
  [--request <json>] \
  [--profile <profile>] \
  [--output-dir <dir>] \
  [--camera-count <n>] \
  [--cloud-mode local|live] \
  [--device-id <id>] \
  [--mqtt-host <host>] \
  [--mqtt-port <port>] \
  [--cloud-api-base-url <url>] \
  [--cloud-api-access-token <token>] \
  [--webrtc-host-candidate-ip <ip>] \
  [--webrtc-udp-port-min <port>] \
  [--webrtc-udp-port-max <port>] \
  [--enable-host-audio-playback] \
  [--host-audio-port <port>] \
  [--interactive]
```

What it does:

- loads the selected profile
- merges schema defaults with the profile base config
- injects the chosen runtime values
- validates the generated config map against service schemas
- writes the resulting config files to `--output-dir`

Interactive behavior:

- if `--interactive` is set, it prompts for:
  - `camera_count`
  - `cloud_mode`
  - `device_id`
  - `cloud_api_base_url` when not already supplied
  - host audio enablement

Request-file keys:

```json
{
  "profile": "local-emulator-all",
  "output_dir": "/tmp/trakrai-configs",
  "camera_count": 2,
  "cloud_mode": "local",
  "device_id": "trakrai-device-local",
  "mqtt_host": "host.docker.internal",
  "mqtt_port": 1883,
  "cloud_api_base_url": "http://127.0.0.1:3000",
  "cloud_api_access_token": "",
  "webrtc_host_candidate_ip": "127.0.0.1",
  "webrtc_udp_port_min": 20000,
  "webrtc_udp_port_max": 20100,
  "enable_host_audio_playback": true,
  "host_audio_port": 18910
}
```

Verified commands:

```bash
python3 -m device.devtool config generate --request /tmp/trakrai-config-request.json
python3 -m device.devtool config generate --interactive --profile local-emulator-core --output-dir /tmp/trakrai-generated-interactive
```

Verification:

- request-driven generation: `Verified end-to-end`
- interactive generation: `Verified end-to-end`

Important notes:

- `cloud_mode=live` is supported but was not used to bring up the live cloud in this local session
- the generated output is validated before it is written

#### `config validate`

Command shape:

```bash
python3 -m device.devtool config validate [--request <json>] --config-dir <dir>
```

What it does:

- loads all known config files from the target directory
- validates them against per-service JSON Schemas
- prints a JSON object with `configDir` and `issues`

Request-file keys:

```json
{
  "config_dir": "/tmp/trakrai-configs"
}
```

Verified commands:

```bash
python3 -m device.devtool config validate --config-dir /private/tmp/trakrai-generated-cloud-configs
python3 -m device.devtool config validate --request /private/tmp/trakrai-config-validate-request.json
```

Verification:

- args-driven: `Verified end-to-end`
- request-only: `Verified end-to-end`

Important note:

- request-file-only execution for `config validate` was fixed in this pass and no longer requires a dummy `--config-dir` argument on the CLI

#### `config scaffold-schemas`

Command shape:

```bash
python3 -m device.devtool config scaffold-schemas \
  [--request <json>] \
  [--service <name> ...] \
  [--force] \
  [--interactive]
```

What it does:

- scaffolds JSON Schemas from sample configs
- can target all services or a subset

Interactive behavior:

- if `--interactive` is used without `--service`, it prompts for one or more services

Request-file keys:

```json
{
  "service": [
    "runtime-manager",
    "cloud-comm"
  ],
  "force": true
}
```

Verified command:

```bash
python3 -m device.devtool config scaffold-schemas --service runtime-manager --service cloud-comm --force
```

Verification:

- subset scaffolding: `Verified end-to-end`
- interactive selection path: `Not exercised in this environment`

#### `config codegen`

Command shape:

```bash
python3 -m device.devtool config codegen \
  [--request <json>] \
  [--service <name> ...] \
  [--go] \
  [--python] \
  [--interactive]
```

What it does:

- reads the service schemas
- emits typed config bindings
- generates only the languages declared by each service manifest
- prunes stale generated files that no longer belong to a declared service/language set

Interactive behavior:

- if `--interactive` is used without `--service`, it prompts for which schema-backed services to generate

Request-file keys:

```json
{
  "service": [
    "cloud-comm"
  ],
  "go": true,
  "python": false
}
```

Supported modes:

- no language flags:
  - generate all declared languages for the selected services
- `--go`:
  - only emit Go bindings for services that declare `go`
- `--python`:
  - only emit Python bindings for services that declare `python`
- `--go --python`:
  - emit both, but only where each service manifest declares them

Verified commands:

```bash
python3 -m device.devtool config codegen
python3 -m device.devtool config codegen --service cloud-comm --go
python3 -m device.devtool config codegen --request /tmp/trakrai-codegen-request.json
```

Verification:

- full codegen: `Verified end-to-end`
- subset codegen: `Verified end-to-end`
- request-driven subset codegen: `Verified end-to-end`

Important note:

- Python generated bindings were corrected in this pass to emit `List[...]` and `Dict[...]`, because the actual local emulator runtime is on Python 3.8 and does not support `list[str]` and `dict[str, str]`

### `contract`

Purpose:

- validate the shared service-method manifest
- generate typed service-contract bindings for runtime, tooling, and web consumers
- keep transport shapes aligned across Go, Python, and TypeScript

#### `contract validate`

Command shape:

```bash
python3 -m device.devtool contract validate
```

What it does:

- loads `device/manifests/service-methods.json`
- validates service, method, payload, and output definitions
- prints a JSON object with `issues`

Verified command:

```bash
python3 -m device.devtool contract validate
```

Verification:

- manifest validation: `Verified end-to-end`

#### `contract codegen`

Command shape:

```bash
python3 -m device.devtool contract codegen \
  [--request <json>] \
  [--service <name> ...] \
  [--go] \
  [--python] \
  [--typescript] \
  [--interactive]
```

Alias command shape:

```bash
python3 -m device.devtool generate contract \
  [--request <json>] \
  [--service <name> ...] \
  [--go] \
  [--python] \
  [--typescript] \
  [--interactive]
```

What it does:

- reads the shared service-method manifest
- emits one generated file per service for each selected language target
- writes an `index.ts` barrel for TypeScript consumers
- prunes stale generated files that no longer belong to a declared service set

Interactive behavior:

- if `--interactive` is used without `--service`, it prompts for which services to generate

Request-file keys:

```json
{
  "service": [
    "runtime-manager"
  ],
  "go": false,
  "python": false,
  "typescript": true
}
```

Supported modes:

- no language flags:
  - generate Go, Python, and TypeScript bindings for the selected services
- `--go`:
  - only emit Go bindings
- `--python`:
  - only emit Python bindings
- `--typescript`:
  - only emit TypeScript bindings
- multiple language flags:
  - emit only the explicitly selected targets

Outputs:

- Go:
  - `device/internal/ipc/contracts/`
- Python:
  - `device/python/trakrai_service_runtime/src/generated_contracts/`
- TypeScript:
  - `web/packages/trakrai-live-transport/src/generated-contracts/`
  - includes one file per service plus `index.ts`

Verified commands:

```bash
python3 -m device.devtool contract codegen
python3 -m device.devtool contract codegen --service runtime-manager --typescript
python3 -m device.devtool generate contract --service runtime-manager --typescript
```

Verification:

- full codegen: `Verified end-to-end`
- subset TypeScript codegen: `Verified end-to-end`
- alias path: `Verified end-to-end`

### `deploy`

Purpose:

- stage the runtime payload and deploy it to a remote SSH device

#### `deploy ssh`

Command shape:

```bash
python3 -m device.devtool deploy ssh \
  [--request <json>] \
  --host <host> \
  --user <user> \
  --password <password> \
  [--port <port>] \
  [--runtime-root <dir>] \
  [--runtime-user <user>] \
  [--runtime-group <group>] \
  [--unit-directory <dir>] \
  [--config-dir <dir>] \
  [--cloud-bridge-url <url>] \
  [--transport-mode edge|cloud] \
  [--http-port <port>] \
  [--start-mode core|all] \
  [--remote-stage-dir <dir>] \
  [--artifact-source local|cloud] \
  [--artifact-platform <platform>] \
  [--artifact-download-root <dir>] \
  [--package-metadata <path>] \
  [--cloud-api-base-url <url>] \
  [--cloud-api-token <token>] \
  [--device-id <id>] \
  [--package-download-path <path>] \
  [--skip-build] \
  [--keep-stage]
```

What it does:

- resolves the config set
  - from `--config-dir` if supplied
  - otherwise by pulling the current configs from the target device
- resolves artifacts
  - from local builds when `--artifact-source local`
  - from the package repository when `--artifact-source cloud`
- prepares a staged runtime tree locally
- uploads the tree to the remote stage directory
- uploads and runs `bootstrap_device_runtime.py`
- verifies remote units and runtime-root contents
- optionally removes the remote stage directory

Request-file keys:

```json
{
  "host": "10.8.0.50",
  "port": 22,
  "user": "hacklab",
  "password": "HACK@LAB",
  "runtime_root": "/home/hacklab/trakrai-device-runtime",
  "runtime_user": "hacklab",
  "runtime_group": "hacklab",
  "unit_directory": "/etc/systemd/system",
  "config_dir": "",
  "cloud_bridge_url": "",
  "transport_mode": "edge",
  "http_port": 8080,
  "start_mode": "all",
  "remote_stage_dir": "/tmp/trakrai-bootstrap-hacklab",
  "artifact_source": "local",
  "artifact_platform": "linux/arm64",
  "artifact_download_root": "",
  "package_metadata": "device/manifests/package-versions.json",
  "cloud_api_base_url": "",
  "cloud_api_token": "",
  "device_id": "",
  "package_download_path": "",
  "skip_build": true,
  "keep_stage": false
}
```

Verified command path:

```bash
python3 -m device.devtool deploy ssh --request /private/tmp/trakrai-deploy-request.json
```

Verification:

- request-file parsing and command path: `Verified structurally`
- live deployment to the configured remote Jetson: `Environment-blocked`

Environment blocker observed:

- a direct connection attempt to `10.8.0.50:22` timed out in this session

Important notes:

- request-file-only execution for `deploy ssh` was fixed in this pass and no longer requires dummy `--host`, `--user`, or `--password` values on the CLI
- `artifact_source=cloud` depends on package metadata and valid cloud-transfer/cloud API credentials in the effective config

### `emulator`

Purpose:

- build or reuse local artifacts
- generate and stage effective configs
- bring up the local Docker-based emulator stack
- inspect or shut down that stack

#### `emulator up`

Command shape:

```bash
python3 -m device.devtool emulator up \
  [--request <json>] \
  --video <path> \
  [--profile <profile>] \
  [--service <name> ...] \
  [--component <name> ...] \
  [--camera-count <n>] \
  [--cloud-mode local|live] \
  [--mqtt-host <host>] \
  [--mqtt-port <port>] \
  [--cloud-api-base-url <url>] \
  [--cloud-api-access-token <token>] \
  [--device-id <id>] \
  [--http-port <port>] \
  [--rtsp-port <port>] \
  [--host-audio-port <port>] \
  [--disable-host-audio-playback] \
  [--platform <platform>] \
  [--skip-build] \
  [--skip-ui-build] \
  [--skip-compose-build] \
  [--compose-project-name <name>] \
  [--start-mode core|all] \
  [--webrtc-udp-port-min <port>] \
  [--webrtc-udp-port-max <port>] \
  [--webrtc-host-candidate-ip <ip>]
```

What it does:

- requires a sample video file for the fake RTSP camera
- resolves services from:
  - the selected profile
  - or the explicit `--service` selection
- resolves components from:
  - explicit `--component` values if supplied
  - otherwise the profile plus required dependencies for the selected services
- generates config files for the selected service set
- stages artifacts into `device/.localdev/stage`
- prepares shared local assets under `device/.localdev/shared`
- manages the host audio relay if selected
- writes the compose environment
- builds compose services unless `--skip-compose-build` is used
- starts the stack and waits for health

Important semantics:

- `--service` now narrows the effective service set instead of leaving unrelated profile configs in place
- `--component` selects the explicit components, then component dependencies are added through manifest closure resolution
- when host audio playback is enabled and `host-audio-player` is in the component set, the tool manages the host-side relay automatically

Request-file keys:

```json
{
  "video": "/Users/hardikj/Downloads/sample.mp4",
  "profile": "local-emulator-all",
  "service": [
    "cloud-comm",
    "runtime-manager",
    "edge-ui"
  ],
  "component": [
    "device-emulator",
    "cloud-api"
  ],
  "camera_count": 1,
  "cloud_mode": "local",
  "mqtt_host": "host.docker.internal",
  "mqtt_port": 1883,
  "cloud_api_base_url": "http://127.0.0.1:3000",
  "cloud_api_access_token": "",
  "device_id": "trakrai-device-local",
  "http_port": 18080,
  "rtsp_port": 18554,
  "host_audio_port": 18910,
  "disable_host_audio_playback": false,
  "platform": "linux/arm64",
  "skip_build": true,
  "skip_ui_build": false,
  "skip_compose_build": true,
  "compose_project_name": "trakrai-local-device",
  "start_mode": "all",
  "webrtc_udp_port_min": 20000,
  "webrtc_udp_port_max": 20100,
  "webrtc_host_candidate_ip": "127.0.0.1"
}
```

Verified commands:

```bash
python3 -m device.devtool emulator up --request /private/tmp/trakrai-emulator-custom-request.json
python3 -m device.devtool emulator up --video /Users/hardikj/Downloads/sample.mp4 --profile local-emulator-all --skip-build --skip-compose-build
```

Verification:

- partial custom stack via request file: `Verified end-to-end`
- full local stack via `local-emulator-all`: `Verified end-to-end`

Observed verified partial custom stack:

- explicit services:
  - `cloud-comm`
  - `runtime-manager`
  - `edge-ui`
  - `cloud-transfer`
- explicit components:
  - `device-emulator`
  - `cloud-api`
- dependency closure added:
  - `redis`
  - `fake-camera`
  - `minio`

Observed verified full stack:

- components:
  - `redis`
  - `fake-camera`
  - `device-emulator`
  - `minio`
  - `cloud-api`
  - `mock-speaker`
  - `host-audio-player`
- managed services:
  - `cloud-comm`
  - `runtime-manager`
  - `edge-ui`
  - `cloud-transfer`
  - `live-feed`
  - `ptz-control`
  - `roi-config`
  - `rtsp-feeder`
  - `video-recorder`
  - `audio-manager`
  - `workflow-engine`

Important note:

- request-file-only execution for `emulator up` was fixed in this pass and no longer requires a dummy `--video` value on the CLI

#### `emulator down`

Command shape:

```bash
python3 -m device.devtool emulator down [--request <json>] [--compose-project-name <name>] [--volumes] [--keep-stage]
```

What it does:

- stops the compose project
- stops the host audio relay
- removes `device/.localdev/stage` unless `--keep-stage` is set

Request-file keys:

```json
{
  "compose_project_name": "trakrai-local-device",
  "volumes": false,
  "keep_stage": true
}
```

Verified command:

```bash
python3 -m device.devtool emulator down --keep-stage
```

Verification:

- `Verified end-to-end`

Observed behavior:

- the stage directory remained intact when `--keep-stage` was used

#### `emulator status`

Command shape:

```bash
python3 -m device.devtool emulator status [--request <json>] [--compose-project-name <name>]
```

What it does:

- runs `docker compose ps` for the local project
- prints host audio relay status as well

Request-file keys:

```json
{
  "compose_project_name": "trakrai-local-device"
}
```

Verified command:

```bash
python3 -m device.devtool emulator status
```

Verification:

- `Verified end-to-end`

#### `emulator logs`

Command shape:

```bash
python3 -m device.devtool emulator logs [--request <json>] [--compose-project-name <name>] [--service <name>] [--lines <n>]
```

What it does:

- tails compose logs
- if `--service host-audio-player` is selected, it tails the host-side audio relay log instead of Docker logs

Request-file keys:

```json
{
  "compose_project_name": "trakrai-local-device",
  "service": "device-emulator",
  "lines": 40
}
```

Verified commands:

```bash
python3 -m device.devtool emulator logs --service device-emulator --lines 40
python3 -m device.devtool emulator logs --service host-audio-player --lines 40
```

Verification:

- compose service logs: `Verified end-to-end`
- host-audio-player logs: `Verified end-to-end`

Important note:

- the `host-audio-player` log in this environment still contained some older startup attempts with `Address already in use`, even while current health checks reported the active process as healthy

### `package`

Purpose:

- calculate changed package versions
- build and publish package artifacts
- pull packaged artifacts back from the cloud repository
- inspect tracked package metadata

#### `package plan`

Command shape:

```bash
python3 -m device.devtool package plan \
  [--metadata <path>] \
  [--package <name> ...] \
  [--request <json>] \
  [--force-package <name> ...] \
  [--json-out <path>]
```

What it does:

- compares current source hashes to metadata
- computes which packages are changed
- computes the next metadata snapshot

Request-file keys:

```json
{
  "metadata": "device/manifests/package-versions.json",
  "package": [
    "runtime-manager",
    "audio-manager"
  ],
  "force_package": [],
  "json_out": "/tmp/trakrai-package-plan.json"
}
```

Verified command:

```bash
python3 -m device.devtool package plan --package runtime-manager --package audio-manager --json-out /tmp/trakrai-package-plan.json
```

Verification:

- `Verified end-to-end`

#### `package release`

Command shape:

```bash
python3 -m device.devtool package release \
  [--metadata <path>] \
  [--package <name> ...] \
  [--request <json>] \
  [--force-package <name> ...] \
  [--platform <platform>] \
  [--publish-target none|cloud-api|s3] \
  [--cloud-api-base-url <url>] \
  [--cloud-api-token <token>] \
  [--package-prefix <prefix>] \
  [--manifest-out <path>] \
  [--no-write-metadata] \
  [--s3-bucket <bucket>] \
  [--s3-region <region>]
```

What it does:

- plans changed packages
- builds their artifacts
- publishes them to the selected target
- updates metadata unless `--no-write-metadata` is used
- writes a release manifest

Request-file keys:

```json
{
  "metadata": "/tmp/trakrai-package-versions-test.json",
  "package": [
    "runtime-manager"
  ],
  "force_package": [],
  "platform": "linux/arm64",
  "publish_target": "cloud-api",
  "cloud_api_base_url": "http://127.0.0.1:3000",
  "cloud_api_token": "",
  "package_prefix": "packages",
  "manifest_out": "/tmp/trakrai-release-manifest.json",
  "write_metadata": true,
  "s3_bucket": "",
  "s3_region": ""
}
```

Verified command:

```bash
python3 -m device.devtool package release --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --publish-target cloud-api --cloud-api-base-url http://127.0.0.1:3000 --manifest-out /tmp/trakrai-release-manifest.json
```

Verification:

- `Verified end-to-end` against the local cloud API and MinIO

Important note:

- this command updates metadata by default; use a temporary metadata file when you want to validate release behavior without mutating the canonical metadata file

#### `package pull`

Command shape:

```bash
python3 -m device.devtool package pull \
  [--metadata <path>] \
  [--package <name> ...] \
  [--request <json>] \
  [--platform <platform>] \
  --cloud-api-base-url <url> \
  [--cloud-api-token <token>] \
  --device-id <id> \
  [--package-download-path <path>] \
  [--output-root <dir>] \
  [--json-out <path>] \
  [--version <version>] \
  [--interactive]
```

What it does:

- resolves the selected packages and versions from metadata
- requests a download session through the cloud API using the device ID
- downloads the package artifacts
- verifies their SHA256 values
- ensures dependent Python wheel artifacts are present where required

Interactive behavior:

- if no `--package` is supplied, it prompts for one or more packages
- if `--interactive` is set with exactly one package and no `--version`, it prompts for the version from package history

Request-file keys:

```json
{
  "metadata": "/tmp/trakrai-package-versions-test.json",
  "package": [
    "runtime-manager"
  ],
  "platform": "linux/arm64",
  "cloud_api_base_url": "http://127.0.0.1:3000",
  "cloud_api_token": "",
  "device_id": "trakrai-device-local",
  "package_download_path": "/api/device/packages/download-session",
  "output_root": "/tmp/trakrai-package-pull",
  "json_out": "/tmp/trakrai-package-pull.json",
  "version": "",
  "interactive": false
}
```

Verified commands:

```bash
python3 -m device.devtool package pull --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local --output-root /tmp/trakrai-package-pull --json-out /tmp/trakrai-package-pull.json
python3 -m device.devtool package pull --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local --output-root /tmp/trakrai-package-pull-interactive --interactive
python3 -m device.devtool package pull --request /private/tmp/trakrai-package-pull-request.json
```

Verification:

- args-driven pull: `Verified end-to-end`
- interactive pull: `Verified end-to-end`
- request-only pull: `Verified end-to-end`

Important note:

- request-file-only execution for `package pull` was fixed in this pass and no longer requires dummy `--cloud-api-base-url` or `--device-id` values on the CLI

#### `package list`

Command shape:

```bash
python3 -m device.devtool package list [--metadata <path>] [--package <name> ...] [--request <json>] [--platform <platform>]
```

What it does:

- prints the tracked version, remote path, and SHA for each package on the selected platform

Request-file keys:

```json
{
  "metadata": "device/manifests/package-versions.json",
  "platform": "linux/arm64"
}
```

Verified command:

```bash
python3 -m device.devtool package list
```

Verification:

- `Verified end-to-end`

### `runtime`

Purpose:

- interact with a running device runtime through the edge websocket API exposed by `cloud-comm` and `runtime-manager`

Common flags for all runtime commands:

- `--request`
- `--url`
  - default: `ws://127.0.0.1:18080/ws`
- `--device-id`
- `--timeout-sec`

#### `runtime status`

Command:

```bash
python3 -m device.devtool runtime status [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>]
```

What it does:

- asks `runtime-manager` for the service/runtime snapshot

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15
}
```

Verified command:

```bash
python3 -m device.devtool runtime status --url ws://127.0.0.1:18080/ws
```

Verification:

- `Verified end-to-end`

#### `runtime start`

Command:

```bash
python3 -m device.devtool runtime start [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name>
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "cloud-transfer"
}
```

Verified command:

```bash
python3 -m device.devtool runtime start --request /private/tmp/trakrai-runtime-start-request.json
```

Verification:

- `Verified end-to-end`

#### `runtime stop`

Command:

```bash
python3 -m device.devtool runtime stop [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name>
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "cloud-transfer"
}
```

Verified command:

```bash
python3 -m device.devtool runtime stop --request /private/tmp/trakrai-runtime-stop-request.json
```

Verification:

- `Verified end-to-end`

#### `runtime restart`

Command:

```bash
python3 -m device.devtool runtime restart [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name>
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "cloud-transfer"
}
```

Verified command:

```bash
python3 -m device.devtool runtime restart --request /private/tmp/trakrai-runtime-restart-request.json
```

Verification:

- `Verified end-to-end`

#### `runtime logs`

Command:

```bash
python3 -m device.devtool runtime logs [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name> [--lines <n>]
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "cloud-comm",
  "lines": 20
}
```

Verified command:

```bash
python3 -m device.devtool runtime logs --url ws://127.0.0.1:18080/ws --service-name cloud-comm --lines 20
```

Verification:

- `Verified end-to-end`

#### `runtime definition`

Command:

```bash
python3 -m device.devtool runtime definition [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name>
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "cloud-comm"
}
```

Verified command:

```bash
python3 -m device.devtool runtime definition --url ws://127.0.0.1:18080/ws --service-name cloud-comm
```

Verification:

- `Verified end-to-end`

#### `runtime config-list`

Command:

```bash
python3 -m device.devtool runtime config-list [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>]
```

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15
}
```

Verified command:

```bash
python3 -m device.devtool runtime config-list --url ws://127.0.0.1:18080/ws
```

Verification:

- `Verified end-to-end`

#### `runtime config-get`

Command:

```bash
python3 -m device.devtool runtime config-get [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --config-name <name> [--output <path>]
```

What it does:

- fetches the live config content from `runtime-manager`
- prints the response envelope
- if `--output` is supplied, writes only the config content JSON to that file

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "config_name": "cloud-comm.json",
  "output": "/tmp/cloud-comm-live.json"
}
```

Verified commands:

```bash
python3 -m device.devtool runtime config-get --url ws://127.0.0.1:18080/ws --config-name cloud-comm.json --output /tmp/cloud-comm-live.json
python3 -m device.devtool runtime config-get --request /private/tmp/trakrai-runtime-config-get-request.json
```

Verification:

- args-driven: `Verified end-to-end`
- request-only: `Verified end-to-end`

Important note:

- request-file-only execution for `runtime config-get` was fixed in this pass and no longer requires a dummy `--config-name` argument on the CLI

#### `runtime config-set`

Command:

```bash
python3 -m device.devtool runtime config-set [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --config-name <name> --content-file <path> [--restart-service <name> ...]
```

What it does:

- reads the JSON content from `--content-file`
- sends the new config to `runtime-manager`
- optionally restarts one or more services after updating the config

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "config_name": "cloud-comm.json",
  "content_file": "/tmp/cloud-comm-live.json",
  "restart_service": [
    "cloud-comm"
  ]
}
```

Verified live-update workflow:

1. Fetched `cloud-comm.json`
2. Changed `edge.rate_limit.max_messages` from `120` to `121`
3. Applied it with restart of `cloud-comm`
4. Confirmed the updated live value
5. Restored the value to `120`

Verification:

- `Verified end-to-end`

Important note:

- when `config-set` restarts `cloud-comm`, the websocket used by the command is expected to drop and can report `unexpected websocket EOF` or a transient reset/timeout while the transport restarts
- this behavior was observed and the runtime recovered afterward

#### `runtime put-file`

Command:

```bash
python3 -m device.devtool runtime put-file [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --path <runtime-path> --content-file <path> [--mode 0644]
```

What it does:

- writes a text file underneath the managed runtime root
- creates parent directories as needed
- is used by the high-level `service push` flow to sync Python runtime support modules and generated config bindings

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "path": "/home/hacklab/trakrai-device-runtime/shared/devtool-smoke/runtime-file.txt",
  "content_file": "device/configs/cloud-comm.sample.json",
  "mode": 420
}
```

Verified commands:

```bash
python3 -m device.devtool runtime put-file --url ws://127.0.0.1:18080/ws --path /home/hacklab/trakrai-device-runtime/shared/devtool-smoke/runtime-file.txt --content-file device/configs/cloud-comm.sample.json
```

Verification:

- `Verified end-to-end`

Important notes:

- `mode` is parsed as octal on the CLI, so `0644` maps to JSON integer `420`
- paths must stay inside the runtime-managed root; arbitrary filesystem writes are rejected by `runtime-manager`

#### `runtime update-service`

Command:

```bash
python3 -m device.devtool runtime update-service [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name> [--remote-path <cloud-path> | --local-path <runtime-path>] [--artifact-sha256 <sha256>]
```

What it does:

- updates one already-managed service through `runtime-manager`
- accepts either:
  - `--remote-path` for cloud-transfer driven download and install
  - `--local-path` for an already-staged artifact in the runtime shared/download area
- is the low-level primitive used by the higher-level `service push` command

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "audio-manager",
  "remote_path": "dev-service-updates/audio-manager/linux-arm64/audio-manager.whl",
  "local_path": "",
  "artifact_sha256": "deadbeef"
}
```

Verified commands:

```bash
python3 -m device.devtool runtime update-service --url ws://127.0.0.1:18080/ws --service-name audio-manager --remote-path dev-service-updates/.../trakrai_audio_manager-0.1.0-py3-none-any.whl --artifact-sha256 <sha256>
```

Verification:

- `Verified end-to-end`

Important notes:

- `--remote-path` and `--local-path` are mutually exclusive
- `runtime-manager` itself cannot be updated through this API
- `cloud-comm` is intentionally handled by the staged control-plane updater instead of the in-band update API

#### `runtime upsert-service`

Command:

```bash
python3 -m device.devtool runtime upsert-service [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --definition-file <path>
```

What it does:

- loads a complete managed-service definition from JSON
- stores it in the runtime-manager state file
- reconciles the wrapper script and systemd unit on the target

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "definition_file": "/tmp/service-definition.json"
}
```

Verified commands:

```bash
python3 -m device.devtool runtime upsert-service --url ws://127.0.0.1:18080/ws --definition-file /tmp/service-definition.json
```

Verification:

- `Verified end-to-end`

Important note:

- this is the low-level definition API; prefer `service push` for manifest-backed rollout because it keeps config, definition, artifact, and start behavior together

#### `runtime remove-service`

Command:

```bash
python3 -m device.devtool runtime remove-service [--request <json>] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] --service-name <name> [--purge-files]
```

What it does:

- removes one managed-service definition from `runtime-manager`
- stops and disables the systemd unit when present
- optionally purges managed install/log/version files when `--purge-files` is passed

Request-file keys:

```json
{
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 15,
  "service_name": "edge-ui",
  "purge_files": false
}
```

Verified commands:

```bash
python3 -m device.devtool runtime remove-service --url ws://127.0.0.1:18080/ws --service-name edge-ui
```

Verification:

- `Verified end-to-end`

Important notes:

- `runtime-manager` cannot remove itself
- config files are not deleted by this command; it removes the managed service definition and runtime artifacts only

### `service`

Purpose:

- provide the one-command developer workflow for updating a single service across supported targets
- keep config sync, definition sync, artifact transfer, runtime-manager update, and start behavior in one manifest-backed command
- make brand-new services work as soon as they are added to the central manifests and have build artifacts/config schema support

#### `service push`

Command:

```bash
python3 -m device.devtool service push [--request <json>] --service <name> [--target emulator|runtime|ssh] [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>] [--artifact-source local|release] [--platform <platform>] [--skip-build] [--skip-ui-build] [--metadata <path>] [--version <value>] [--cloud-api-base-url <url>] [--cloud-api-token <token>] [--package-download-path <path>] [--publish-target cloud-api|s3] [--package-prefix <prefix>] [--s3-bucket <bucket>] [--s3-region <region>] [--config-source auto|current|profile|sample|schema|file|skip] [--config-file <path>] [--profile <name>] [--enable] [--disable] [--interactive] [--host <host>] [--port <port>] [--user <user>] [--password <password>] [--runtime-root <path>]
```

What it does:

- resolves the target connection:
  - `emulator`: local websocket runtime on `ws://127.0.0.1:18080/ws`
  - `runtime`: arbitrary websocket runtime, defaulting to the local emulator URL if `--url` is omitted
  - `ssh`: remote runtime reached through SSH plus the runtime-manager request helper
- loads current target status and runtime layout from `runtime-manager`
- renders the manifest-backed service definition for the target runtime root, config dir, user, group, and script paths
- resolves config content from:
  - current live config
  - profile output
  - sample config
  - schema defaults
  - explicit file
  - skip
- creates missing config files when the service has not been provisioned before
- creates or updates the runtime-manager definition, including wrapper script/systemd unit wiring
- for Python services, syncs:
  - `trakrai_service_runtime`
  - generated config runtime support files
  - the service-specific generated config module
- resolves the artifact from local build output or release metadata
- chooses the artifact transport automatically:
  - `runtime` target uses a cloud path and `runtime-manager update-service --remote-path`
  - `emulator` target stages a local runtime file and uses `--local-path`
  - `ssh` target uploads the artifact into the runtime shared path and uses `--local-path`
- starts the service when it is enabled, controllable, and not already running after the update
- prints the final service snapshot from a fresh runtime-manager status call

Supported target and artifact combinations:

- `--target emulator --artifact-source local`: build or reuse a local artifact, stage it into the emulator runtime, then update in place
- `--target emulator --artifact-source release`: pull the released artifact locally, stage it into the emulator runtime, then update in place
- `--target runtime --artifact-source local`: publish the dev artifact to the configured cloud API/S3 target, then tell the runtime to fetch it
- `--target runtime --artifact-source release`: resolve the release metadata and tell the runtime to fetch that artifact directly
- `--target ssh --artifact-source local`: build locally, upload into the remote runtime shared area, then update through the remote helper
- `--target ssh --artifact-source release`: pull the release locally, upload into the remote runtime shared area, then update through the remote helper

Special control-plane handling:

- `runtime-manager` and `cloud-comm` are handled by the staged `update_control_plane.py` helper instead of the normal in-band `update-service` API
- those control-plane updates are supported for `--target emulator` and `--target ssh`
- they are intentionally rejected for plain `--target runtime` because replacing the live transport/control plane in-band is not reliable

Request-file keys:

```json
{
  "service": "audio-manager",
  "target": "runtime",
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 30,
  "artifact_source": "local",
  "platform": "linux/arm64",
  "skip_build": true,
  "skip_ui_build": false,
  "metadata": "device/out/package-versions.json",
  "version": "",
  "cloud_api_base_url": "",
  "cloud_api_token": "",
  "package_download_path": "/api/device/packages/download",
  "publish_target": "cloud-api",
  "package_prefix": "trakrai",
  "s3_bucket": "",
  "s3_region": "",
  "config_source": "current",
  "config_file": "",
  "profile": "",
  "enable": false,
  "disable": false,
  "host": "",
  "port": 22,
  "user": "",
  "password": "",
  "runtime_root": "/home/hacklab/trakrai-device-runtime"
}
```

Verified commands:

```bash
python3 -m device.devtool service push --service audio-manager --target emulator --config-source current --skip-build
python3 -m device.devtool service push --service audio-manager --target runtime --config-source current --skip-build
python3 -m device.devtool service push --service audio-manager --target runtime --artifact-source release --metadata /tmp/package-metadata.json --config-source current --skip-build
python3 -m device.devtool service push --service edge-ui --target runtime --skip-build --config-source skip
python3 -m device.devtool service push --service runtime-manager --target emulator --artifact-source local --cloud-api-base-url http://127.0.0.1:3000
```

Verification:

- emulator local-artifact flow: `Verified end-to-end`
- runtime local-artifact flow: `Verified end-to-end`
- runtime release-artifact flow: `Verified end-to-end`
- brand-new runtime provisioning flow:
  - `edge-ui` was removed from `runtime-manager`
  - `service push --service edge-ui --target runtime --skip-build --config-source skip` recreated the managed definition and reinstalled the UI bundle
  - `Verified end-to-end`
- emulator control-plane update flow for `runtime-manager`: `Verified end-to-end`
- ssh transport flow: `Verified structurally`

Important notes:

- the final JSON output now includes `serviceSnapshot`, which is pulled from a fresh post-update runtime status call
- Python services do not rely only on the wheel artifact anymore; the required generated config module and shared Python runtime support are synced as part of the same command
- if `--config-source current` is used for a brand-new service, the command fails because there is no live config yet; use `profile`, `sample`, `schema`, `file`, or `skip`
- SSH end-to-end execution remained blocked in this environment because `10.8.0.50:22` timed out during connectivity checks

### `test`

Purpose:

- run reusable JSON-defined verification workflows against the local emulator
- push synthetic workflow detections into the local stack

#### `test list`

Command:

```bash
python3 -m device.devtool test list
```

What it does:

- prints the available test workflow manifests

Verification:

- `Verified end-to-end`

#### `test run`

Command:

```bash
python3 -m device.devtool test run [--request <json>] --test-name <name> [--url <ws-url>] [--device-id <id>] [--timeout-sec <sec>]
```

What it does:

- loads the named test manifest
- executes its JSON-defined steps through the runtime/test harness
- prints the test name and the final execution context

Request-file keys:

```json
{
  "test_name": "cloud-transfer-local",
  "url": "ws://127.0.0.1:18080/ws",
  "device_id": "",
  "timeout_sec": 120
}
```

Verified commands:

```bash
python3 -m device.devtool test run --request /private/tmp/trakrai-test-run-request.json
python3 -m device.devtool test run --test-name audio-service-local
python3 -m device.devtool test run --test-name violation-service-local
```

Verification:

- request-only `cloud-transfer-local`: `Verified end-to-end`
- `audio-service-local`: `Verified end-to-end`
- `violation-service-local`: `Verified end-to-end`

Important note:

- request-file-only execution for `test run` was fixed in this pass and no longer requires a dummy `--test-name` argument on the CLI

#### `test feed-workflow`

Command:

```bash
python3 -m device.devtool test feed-workflow [--request <json>] --input <path> [--compose-project-name <name>] [--delay-ms <ms>] [--request-timeout-sec <sec>] [--shared-target <path>]
```

What it does:

- copies the mock detections file into the emulator shared target
- triggers the workflow ingestion path used by the workflow engine

Request-file keys:

```json
{
  "input": "device/localdev/detections/sample-detections.json",
  "compose_project_name": "trakrai-local-device",
  "delay_ms": -1,
  "request_timeout_sec": 10,
  "shared_target": "mock-workflow-inputs/detections.json"
}
```

Verified command:

```bash
python3 -m device.devtool test feed-workflow --request /private/tmp/trakrai-feed-workflow-request.json
```

Verification:

- `Verified end-to-end`

Important note:

- request-file-only execution for `test feed-workflow` was fixed in this pass and no longer requires a dummy `--input` argument on the CLI

## High-Value Flows

### Flow: Inspect The Current System Surface

```bash
python3 -m device.devtool manifest list services
python3 -m device.devtool manifest list components
python3 -m device.devtool manifest list profiles
python3 -m device.devtool manifest list tests
python3 -m device.devtool manifest validate
```

Use this when:

- adding a new service
- validating a manifest edit
- confirming what a profile currently includes

### Flow: Build Everything For Local Work Or CI

```bash
python3 -m device.devtool build all
```

Use this when:

- validating that all service artifacts still build
- preparing a full local stage
- preparing CI-compatible build output

### Flow: Build Only A Single Service Or A Small Subset

```bash
python3 -m device.devtool build service --service runtime-manager
python3 -m device.devtool build service --service runtime-manager --service audio-manager
```

Use this when:

- iterating on one service
- validating a local service-specific change

### Flow: Regenerate And Validate Configs

```bash
python3 -m device.devtool config generate --profile local-emulator-all --output-dir /tmp/trakrai-configs
python3 -m device.devtool config validate --config-dir /tmp/trakrai-configs
```

Use this when:

- profile defaults changed
- schemas changed
- you need a known-good config set to deploy or stage

### Flow: Regenerate Typed Config Bindings

```bash
python3 -m device.devtool config codegen
```

Use this when:

- a JSON Schema changed
- a new service schema was added
- Go or Python service config structs/classes need regeneration

### Flow: Regenerate Typed Service Contracts

```bash
python3 -m device.devtool generate contract
```

Use this when:

- `device/manifests/service-methods.json` changed
- a service added, removed, or renamed a method
- the web or runtime bindings need to stay aligned with the shared contract manifest

### Flow: Release And Pull A Single Package Through The Local Cloud API

```bash
python3 -m device.devtool package release --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --publish-target cloud-api --cloud-api-base-url http://127.0.0.1:3000 --manifest-out /tmp/trakrai-release-manifest.json
python3 -m device.devtool package pull --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local --output-root /tmp/trakrai-package-pull --json-out /tmp/trakrai-package-pull.json
```

Use this when:

- validating the package repository flow locally
- preparing deployable artifacts for cloud-driven device pulls

### Flow: Bring Up The Full Local Emulator

```bash
python3 -m device.devtool emulator up --video /Users/hardikj/Downloads/sample.mp4 --profile local-emulator-all --skip-build --skip-compose-build
python3 -m device.devtool emulator status
```

Use this when:

- validating the complete local runtime
- running the audio, cloud-transfer, or violation workflows

### Flow: Bring Up Only A Partial Local Stack

Use a request file to make the selection explicit:

```json
{
  "video": "/Users/hardikj/Downloads/sample.mp4",
  "profile": "local-emulator-core",
  "service": [
    "cloud-comm",
    "runtime-manager",
    "edge-ui",
    "cloud-transfer"
  ],
  "component": [
    "device-emulator",
    "cloud-api"
  ],
  "skip_build": true,
  "skip_compose_build": true
}
```

Then:

```bash
python3 -m device.devtool emulator up --request /private/tmp/trakrai-emulator-custom-request.json
```

Use this when:

- validating only a subset of services
- iterating on cloud-transfer without the full media/audio stack
- bringing up only the components you need

### Flow: Update A Live Config On A Running Emulator

```bash
python3 -m device.devtool runtime config-get --url ws://127.0.0.1:18080/ws --config-name cloud-comm.json --output /tmp/cloud-comm-live.json
python3 -m device.devtool runtime config-set --url ws://127.0.0.1:18080/ws --config-name cloud-comm.json --content-file /tmp/cloud-comm-live.json --restart-service cloud-comm
```

Use this when:

- testing a config edit without rebuilding the stack
- validating config hot-update behavior

### Flow: Start, Stop, And Restart Individual Services

```bash
python3 -m device.devtool runtime stop --request /private/tmp/trakrai-runtime-stop-request.json
python3 -m device.devtool runtime start --request /private/tmp/trakrai-runtime-start-request.json
python3 -m device.devtool runtime restart --request /private/tmp/trakrai-runtime-restart-request.json
```

Use this when:

- isolating a service failure
- validating service lifecycle hooks

### Flow: Run The Reusable Test Workflows

```bash
python3 -m device.devtool test list
python3 -m device.devtool test run --request /private/tmp/trakrai-test-run-request.json
python3 -m device.devtool test run --test-name audio-service-local
python3 -m device.devtool test run --test-name violation-service-local
python3 -m device.devtool test feed-workflow --request /private/tmp/trakrai-feed-workflow-request.json
```

Use this when:

- verifying full workflow behavior after a service change
- validating the composed JSON-defined test flows instead of ad-hoc scripts

### Flow: Deploy To A Real Device Over SSH

Basic local-artifact flow:

```bash
python3 -m device.devtool deploy ssh --host 10.8.0.50 --user hacklab --password 'HACK@LAB' --skip-build
```

Cloud-artifact flow shape:

```bash
python3 -m device.devtool deploy ssh \
  --host 10.8.0.50 \
  --user hacklab \
  --password 'HACK@LAB' \
  --artifact-source cloud \
  --cloud-api-base-url http://127.0.0.1:3000 \
  --device-id trakrai-device-local
```

Status:

- command surface and request-file path: verified
- live SSH deployment to the configured target was blocked in this session by a timeout to `10.8.0.50:22`

## Fully Verified Command Matrix

The following command paths were executed during this documentation pass and the preceding implementation pass that produced the current working tree.

Manifest and completion:

- `python3 -m device.devtool manifest list services`
- `python3 -m device.devtool manifest list components`
- `python3 -m device.devtool manifest list profiles`
- `python3 -m device.devtool manifest list tests`
- `python3 -m device.devtool manifest validate`
- `python3 -m device.devtool completion bash`
- `python3 -m device.devtool completion zsh`
- `python3 -m device.devtool completion fish`

Build:

- `python3 -m device.devtool build service --service runtime-manager --service audio-manager`
- `python3 -m device.devtool build all`

Config:

- `python3 -m device.devtool config generate --request /tmp/trakrai-config-request.json`
- `python3 -m device.devtool config generate --interactive --profile local-emulator-core --output-dir /tmp/trakrai-generated-interactive`
- `python3 -m device.devtool config validate --config-dir /private/tmp/trakrai-generated-cloud-configs`
- `python3 -m device.devtool config validate --request /private/tmp/trakrai-config-validate-request.json`
- `python3 -m device.devtool config scaffold-schemas --service runtime-manager --service cloud-comm --force`
- `python3 -m device.devtool config codegen`
- `python3 -m device.devtool config codegen --service cloud-comm --go`
- `python3 -m device.devtool config codegen --request /tmp/trakrai-codegen-request.json`

Package:

- `python3 -m device.devtool package plan --package runtime-manager --package audio-manager --json-out /tmp/trakrai-package-plan.json`
- `python3 -m device.devtool package list`
- `python3 -m device.devtool package release --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --publish-target cloud-api --cloud-api-base-url http://127.0.0.1:3000 --manifest-out /tmp/trakrai-release-manifest.json`
- `python3 -m device.devtool package pull --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local --output-root /tmp/trakrai-package-pull --json-out /tmp/trakrai-package-pull.json`
- `python3 -m device.devtool package pull --metadata /tmp/trakrai-package-versions-test.json --package runtime-manager --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local --output-root /tmp/trakrai-package-pull-interactive --interactive`
- `python3 -m device.devtool package pull --request /private/tmp/trakrai-package-pull-request.json`

Emulator:

- `python3 -m device.devtool emulator down --keep-stage`
- `python3 -m device.devtool emulator up --request /private/tmp/trakrai-emulator-custom-request.json`
- `python3 -m device.devtool emulator up --video /Users/hardikj/Downloads/sample.mp4 --profile local-emulator-all --skip-build --skip-compose-build`
- `python3 -m device.devtool emulator status`
- `python3 -m device.devtool emulator logs --service device-emulator --lines 40`
- `python3 -m device.devtool emulator logs --service host-audio-player --lines 40`

Runtime:

- `python3 -m device.devtool runtime status --url ws://127.0.0.1:18080/ws`
- `python3 -m device.devtool runtime definition --url ws://127.0.0.1:18080/ws --service-name cloud-comm`
- `python3 -m device.devtool runtime logs --url ws://127.0.0.1:18080/ws --service-name cloud-comm --lines 20`
- `python3 -m device.devtool runtime config-list --url ws://127.0.0.1:18080/ws`
- `python3 -m device.devtool runtime config-get --url ws://127.0.0.1:18080/ws --config-name cloud-comm.json --output /tmp/cloud-comm-live.json`
- `python3 -m device.devtool runtime config-get --request /private/tmp/trakrai-runtime-config-get-request.json`
- `python3 -m device.devtool runtime stop --request /private/tmp/trakrai-runtime-stop-request.json`
- `python3 -m device.devtool runtime start --request /private/tmp/trakrai-runtime-start-request.json`
- `python3 -m device.devtool runtime restart --request /private/tmp/trakrai-runtime-restart-request.json`
- live `runtime config-set` workflow with restart of `cloud-comm`

Tests:

- `python3 -m device.devtool test list`
- `python3 -m device.devtool test run --request /private/tmp/trakrai-test-run-request.json`
- `python3 -m device.devtool test run --test-name audio-service-local`
- `python3 -m device.devtool test run --test-name violation-service-local`
- `python3 -m device.devtool test feed-workflow --request /private/tmp/trakrai-feed-workflow-request.json`

Deploy:

- `python3 -m device.devtool deploy ssh --request /private/tmp/trakrai-deploy-request.json`
- status: `Verified structurally`, blocked from full end-to-end completion by the remote SSH timeout

Help surface:

- all top-level `--help` commands
- all subcommand `--help` commands under:
  - `build`
  - `config`
  - `deploy`
  - `emulator`
  - `package`
  - `runtime`
  - `test`

## Current Operational Caveats

- `runtime config-set` with `--restart-service cloud-comm` restarts the websocket bridge the command is currently using. An EOF/reset during that restart is expected.
- `deploy ssh` could not be completed against `10.8.0.50` in this session because port `22` timed out.
- `host-audio-player` logs may contain stale failed bind attempts even when the current process is healthy.
- `emulator up` requires a real video file path for the fake camera.
- `package release` mutates package metadata by default unless `--no-write-metadata` is used.

## Recommended Daily Usage

For most local development cycles:

1. Validate manifests:

   ```bash
   python3 -m device.devtool manifest validate
   ```

2. Regenerate config bindings if schemas changed:

   ```bash
   python3 -m device.devtool config codegen
   ```

3. Regenerate service contracts if the shared service-method manifest changed:

   ```bash
   python3 -m device.devtool generate contract
   ```

4. Build only the services you changed:

   ```bash
   python3 -m device.devtool build service --service runtime-manager
   ```

5. Bring up the smallest emulator profile or subset you need:

   ```bash
   python3 -m device.devtool emulator up --request /path/to/request.json
   ```

6. Validate the runtime and tests:

   ```bash
   python3 -m device.devtool runtime status --url ws://127.0.0.1:18080/ws
   python3 -m device.devtool test run --test-name cloud-transfer-local
   ```

7. If you need live config iteration, use:

   ```bash
   python3 -m device.devtool runtime config-get ...
   python3 -m device.devtool runtime config-set ...
   ```
