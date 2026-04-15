# TrakrAI Workflow Engine

This package contains the first migration slice of the legacy workflow engine into
the new `trakrai/device` runtime.

Current scope:

- workflow JSON parsing, validation, DAG build, and execution
- workflow file polling and hot reload
- minimal detection-driven nodes:
  - `detection-input`
  - `get-detections`
  - `get-camera-id`
- IPC-integrated edge service for queued workflow submissions
- feeder CLI for local workflow testing

External workflow/schema sync from the legacy runtime is intentionally not included.
