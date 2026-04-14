# AI Inference Service

This service is the first split-out Python worker for device AI inference.

What it does:

- reads the latest JPEG frame from Redis at `<key_prefix>:<camera_name>:latest`
- reuses the legacy `server_batch.py` model runtime from the configured legacy AI repo
- draws bounding boxes on the processed frame
- writes annotated images back to Redis using the existing keys:
  - `<key_prefix>:<camera_name>:processed`
  - `<key_prefix>:<camera_name>:processed_time`
  - `<key_prefix>:<camera_name>:processed_images`
- writes the latest detection payload JSON to:
  - `<key_prefix>:<camera_name>:detections`
  - `<key_prefix>:<camera_name>:detections_time`

Local source run from the repo root:

```powershell
python device\python\ai_inference\main.py -config device\configs\ai-inference.sample.json
```

Build a versioned wheel from `D:\trakrbi\trakrai\device`:

```powershell
make build-ai-inference-wheel AI_INFERENCE_VERSION=0.1.0
```

The Docker-based build drops artifacts into:

- `device/out/ai-inference-wheel/`

Install on the Jetson without modifying the existing dependency set:

```bash
python3 -m pip install --no-deps --force-reinstall ./trakrai_ai_inference-0.1.0-py3-none-any.whl
```

Run the installed package:

```bash
trakrai-ai-inference -config /home/hacklab/trakrai-device-runtime/ai-inference.json
```

Notes:

- No Python libraries are installed or changed by this service.
- `requirements.txt` pins the validated Jetson package versions for this worker and the legacy PyTorch inference path it imports.
- The wheel intentionally assumes a pre-provisioned runtime and should be installed with `--no-deps` on the Jetson so the working device libraries stay untouched.
- Package code lives under `src/ai_inference/`, and the repo-root `main.py` is only a thin local-development wrapper.
- The service expects the legacy AI repo path through `inference.legacy_code_root`.
- Model paths are configured in JSON under `inference.models`.
- The current recommended Jetson profile is `yolov5s.pt`, `fp16_inference=true`, `inference_image_size=[512, 512]`, `poll_interval_ms=5`, and `idle_sleep_ms=40`.
- On-device validation against the live Redis feed showed:
  - `640x640` was fast enough but unstable under memory pressure on the 4 GB device.
  - `512x512` stayed stable for a 2 minute soak with average inference around `97-98 ms` per processed frame.
  - `416x416` was faster but changed the live detections enough that it is not the current default recommendation.
- A TensorRT `.engine` path is supported through the legacy loader, but the current device test environment is missing the Python `tensorrt` module, so no library changes were made.
