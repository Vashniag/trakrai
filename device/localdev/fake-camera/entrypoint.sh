#!/bin/bash
set -euo pipefail

VIDEO_FILE="${TRAKRAI_VIDEO_FILE:-/video/input.mp4}"
RTSP_PATH="${TRAKRAI_RTSP_PATH:-stream}"

if [[ ! -f "${VIDEO_FILE}" ]]; then
  echo "fake-camera: video file not found: ${VIDEO_FILE}" >&2
  exit 1
fi

cleanup() {
  jobs -pr | xargs -r kill >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

/usr/local/bin/mediamtx &
MEDIAMTX_PID=$!

for _attempt in $(seq 1 50); do
  if nc -z 127.0.0.1 8554 >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

ffmpeg \
  -loglevel warning \
  -re \
  -stream_loop -1 \
  -i "${VIDEO_FILE}" \
  -an \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -preset veryfast \
  -tune zerolatency \
  -f rtsp \
  -rtsp_transport tcp \
  "rtsp://127.0.0.1:8554/${RTSP_PATH}" &
PUBLISHER_PID=$!

wait -n "${MEDIAMTX_PID}" "${PUBLISHER_PID}"
