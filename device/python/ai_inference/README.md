# AI Inference Service

This service is the first split-out Python worker for device AI inference.

What it does:

- reads the latest JPEG frame from Redis at `<key_prefix>:<camera_name>:latest`
- reuses the legacy `TRAKR_AI_PTZ/server_batch.py` model runtime
- draws bounding boxes on the processed frame
- writes annotated images back to Redis using the existing keys:
  - `<key_prefix>:<camera_name>:processed`
  - `<key_prefix>:<camera_name>:processed_time`
  - `<key_prefix>:<camera_name>:processed_images`
- writes the latest detection payload JSON to:
  - `<key_prefix>:<camera_name>:detections`
  - `<key_prefix>:<camera_name>:detections_time`

Run from the repo root:

```powershell
python device\python\ai_inference\main.py -config device\configs\ai-inference.sample.json
```

Notes:

- No Python libraries are installed or changed by this service.
- The service expects the legacy AI repo path through `inference.legacy_code_root`.
- Model paths are configured in JSON under `inference.models`.
- The current recommended Jetson profile is `yolov5s.pt`, `fp16_inference=true`, `inference_image_size=[512, 512]`, `poll_interval_ms=5`, and `idle_sleep_ms=40`.
- On-device validation against the live Redis feed showed:
  - `640x640` was fast enough but unstable under memory pressure on the 4 GB device.
  - `512x512` stayed stable for a 2 minute soak with average inference around `97-98 ms` per processed frame.
  - `416x416` was faster but changed the live detections enough that it is not the current default recommendation.
- A TensorRT `.engine` path is supported through the legacy loader, but the current device test environment is missing the Python `tensorrt` module, so no library changes were made.
