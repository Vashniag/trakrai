# Device Developer Tooling

The deployment, package, emulator, config, and test entrypoints now live directly under the manifest-driven developer CLI:

```bash
python3 -m device.devtool ...
```

`device.devtool` is the maintained entry surface. Device-side staged helpers live under `device/devtool/device_side/`, and operator/developer docs live under `device/docs/`.

For the exhaustive command reference, tested flows, request-file shapes, and command-by-command verification notes, use:

- `device/docs/devtool-instructions.md`

For the detailed human developer guide for adding JSONSchema-backed service methods, regenerating bindings, wiring provider/caller code, and verifying the flow, use:

- `device/docs/service-method-contracts-guide.md`

## Main command groups

```bash
python3 -m device.devtool manifest list services
python3 -m device.devtool manifest validate

python3 -m device.devtool build all
python3 -m device.devtool build service --service runtime-manager

python3 -m device.devtool package plan
python3 -m device.devtool package release --publish-target cloud-api
python3 -m device.devtool package pull --interactive --cloud-api-base-url http://127.0.0.1:3000 --device-id trakrai-device-local

python3 -m device.devtool config scaffold-schemas --force
python3 -m device.devtool config codegen
python3 -m device.devtool config generate --profile local-emulator-all --output-dir device/.localdev/generated-configs/local-emulator-all
python3 -m device.devtool config validate --config-dir device/.localdev/generated-configs/local-emulator-all

python3 -m device.devtool emulator up --video /absolute/path/to/video.mp4
python3 -m device.devtool emulator status
python3 -m device.devtool emulator logs --service device-emulator
python3 -m device.devtool emulator down

python3 -m device.devtool runtime status --url ws://127.0.0.1:18080/ws
python3 -m device.devtool runtime config-list --url ws://127.0.0.1:18080/ws
python3 -m device.devtool runtime config-get --config-name cloud-comm.json --output /tmp/cloud-comm.json
python3 -m device.devtool runtime config-set --config-name cloud-comm.json --content-file /tmp/cloud-comm.json --restart-service cloud-comm
python3 -m device.devtool runtime put-file --url ws://127.0.0.1:18080/ws --path /home/hacklab/trakrai-device-runtime/shared/devtool-smoke/runtime-file.txt --content-file device/configs/cloud-comm.sample.json
python3 -m device.devtool runtime update-service --url ws://127.0.0.1:18080/ws --service-name audio-manager --remote-path dev-service-updates/.../trakrai_audio_manager-0.1.0-py3-none-any.whl --artifact-sha256 <sha256>
python3 -m device.devtool runtime upsert-service --url ws://127.0.0.1:18080/ws --definition-file /tmp/service-definition.json
python3 -m device.devtool runtime remove-service --url ws://127.0.0.1:18080/ws --service-name smoke-runtime-asset

python3 -m device.devtool service push --service audio-manager --target emulator --config-source current --skip-build
python3 -m device.devtool service push --service audio-manager --target runtime --config-source current --skip-build
python3 -m device.devtool service push --service audio-manager --target runtime --artifact-source release --metadata /tmp/package-metadata.json --config-source current --skip-build
python3 -m device.devtool service push --service edge-ui --target runtime --skip-build --config-source skip
python3 -m device.devtool service push --service runtime-manager --target emulator --artifact-source local --cloud-api-base-url http://127.0.0.1:3000

python3 -m device.devtool deploy ssh --host 10.8.0.50 --user hacklab --password 'HACK@LAB'

python3 -m device.devtool test list
python3 -m device.devtool test run --test-name cloud-transfer-local
python3 -m device.devtool test run --test-name audio-service-local
python3 -m device.devtool test run --test-name violation-service-local
python3 -m device.devtool test feed-workflow --input device/localdev/detections/sample-detections.json
```

## Request files

Most commands accept `--request <json-file>`.

That lets you store repeatable operations as JSON payloads instead of repeatedly typing the same interactive answers or CLI flags.

Example:

```json
{
  "profile": "local-emulator-all",
  "camera_count": 2,
  "cloud_mode": "local",
  "device_id": "trakrai-device-local"
}
```

Then run:

```bash
python3 -m device.devtool config generate --request /path/to/request.json
```

For single-service dev rollout, `service push` is now the primary entrypoint. It handles:

- manifest-backed definition generation
- config creation or update
- Python runtime support sync when needed
- artifact publish/stage by target
- runtime-manager update and start behavior

That includes brand-new services already declared in `device/manifests/services.json`; the command will provision the runtime-manager definition and any missing config before installing the artifact.

## Central sources of truth

- Services: `device/manifests/services.json`
- Components: `device/manifests/components.json`
- Profiles: `device/manifests/profiles/*.json`
- Test workflows: `device/manifests/tests/*.json`
- Config schemas: `device/config-schemas/services/*.schema.json`
- Generated config bindings:
  - Go: `device/internal/generatedconfig/`
  - Python: `device/python/generated_configs/`

Only the language declared by each service manifest is generated. Go services emit Go bindings; Python services emit Python bindings. Runtime staging and Python package hashing now only carry the generated config modules required by the selected Python services.

## Internal Runtime Assets

- Device-side staged helpers live under `device/devtool/device_side/`
- Internal helper modules live under `device/devtool/tools/`
- Operational docs live under `device/docs/`
