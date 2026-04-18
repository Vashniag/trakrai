#!/bin/bash
set -euo pipefail

# Looping RTSP publisher. Supports multiple "cameras" by fanning out the same
# input file (or a per-camera video, if /video/stream-N.mp4 exists) into
# distinct RTSP paths: /stream1, /stream2, ...
#
# Drivers:
#   TRAKRAI_VIDEO_FILE   - default mp4 source
#   TRAKRAI_RTSP_PATH    - legacy single-path prefix (used only when count=1)
#   TRAKRAI_CAMERA_COUNT - how many parallel RTSP paths to publish

VIDEO_FILE="${TRAKRAI_VIDEO_FILE:-/video/input.mp4}"
RTSP_PATH="${TRAKRAI_RTSP_PATH:-stream}"
CAMERA_COUNT="${TRAKRAI_CAMERA_COUNT:-1}"

if ! [[ "${CAMERA_COUNT}" =~ ^[0-9]+$ ]] || [[ "${CAMERA_COUNT}" -lt 1 ]]; then
  CAMERA_COUNT=1
fi

if [[ ! -f "${VIDEO_FILE}" ]]; then
  echo "fake-camera: video file not found: ${VIDEO_FILE}" >&2
  exit 1
fi

PUBLISHER_PIDS=()

cleanup() {
  jobs -pr | xargs -r kill >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

# Rewrite mediamtx config with one path entry per camera so they all go through
# the same broker with per-stream stats.
{
  echo "paths:"
  for ((i = 1; i <= CAMERA_COUNT; i++)); do
    echo "  stream${i}: {}"
  done
  # Keep legacy /stream alias for backwards compat with older configs.
  echo "  ${RTSP_PATH}: {}"
} >/mediamtx.yml

/usr/local/bin/mediamtx &
MEDIAMTX_PID=$!

for _attempt in $(seq 1 50); do
  if nc -z 127.0.0.1 8554 >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

start_publisher() {
  local rtsp_path="$1"
  local source_file="$2"
  ffmpeg \
    -loglevel warning \
    -re \
    -stream_loop -1 \
    -i "${source_file}" \
    -an \
    -c:v libx264 \
    -pix_fmt yuv420p \
    -preset veryfast \
    -tune zerolatency \
    -f rtsp \
    -rtsp_transport tcp \
    "rtsp://127.0.0.1:8554/${rtsp_path}" &
  PUBLISHER_PIDS+=($!)
}

for ((i = 1; i <= CAMERA_COUNT; i++)); do
  per_camera_file="/video/stream-${i}.mp4"
  if [[ -f "${per_camera_file}" ]]; then
    start_publisher "stream${i}" "${per_camera_file}"
  else
    start_publisher "stream${i}" "${VIDEO_FILE}"
  fi
done

# Legacy single-camera path aliased to the default input so existing sample
# configs that point at /stream keep working.
if [[ "${CAMERA_COUNT}" -eq 1 && "${RTSP_PATH}" != "stream1" ]]; then
  start_publisher "${RTSP_PATH}" "${VIDEO_FILE}"
fi

wait -n "${MEDIAMTX_PID}" "${PUBLISHER_PIDS[@]}"
