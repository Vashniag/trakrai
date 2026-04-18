#!/usr/bin/env bash
# One-shot full-stack bringup. Intentionally simple — anyone inspecting this
# should be able to reproduce every step by hand from docs/BRINGUP.md.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

: "${PYTHON:=python}"
: "${CAMERA_COUNT:=2}"
: "${PROFILE:=local-emulator-gpu}"

step() {
  printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

step "1. install web workspace (if needed)"
if [ ! -d web/node_modules ]; then
  (cd web && pnpm install)
else
  echo "skipped — web/node_modules already present"
fi

step "2. start cloud infra (postgres + mqtt + live-gateway)"
(cd deploy && docker compose up -d postgres mosquitto live-gateway)

step "3. download sample video + YOLOv5n weights"
${PYTHON} -m device.devtool assets download --all

step "4. build GPU emulator image"
docker build -t trakrai-local-device-emulator:gpu \
  -f device/localdev/device-emulator/Dockerfile.gpu \
  device/localdev/device-emulator

step "5. build ai-inference wheel (linux/amd64)"
${PYTHON} -m device.devtool build service \
  --service trakrai-ai-inference \
  --platform linux/amd64 || true

step "6. bring up the emulator (profile=${PROFILE}, cameras=${CAMERA_COUNT})"
${PYTHON} -m device.devtool emulator up \
  --gpu \
  --auto-assets \
  --profile "${PROFILE}" \
  --camera-count "${CAMERA_COUNT}"

step "7. summary"
${PYTHON} -m device.devtool emulator status
echo
echo "Edge UI       : http://localhost:18080/"
echo "Runtime API   : http://localhost:18080/api/runtime-config"
echo "Live gateway  : http://localhost:4000/api/health"
echo "MinIO console : http://localhost:29001/ (minioadmin / minioadmin)"
echo "Cloud API     : http://localhost:3000/health"
