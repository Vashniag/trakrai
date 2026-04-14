#!/bin/bash
set -euo pipefail

export TRAKRAI_RUNTIME_ROOT="${TRAKRAI_RUNTIME_ROOT:-/home/hacklab/trakrai-device-runtime}"
export TRAKRAI_SYSTEMCTL_UNIT_DIR="${TRAKRAI_SYSTEMCTL_UNIT_DIR:-${TRAKRAI_RUNTIME_ROOT}/units}"
export TRAKRAI_SYSTEMCTL_STATE_DIR="${TRAKRAI_SYSTEMCTL_STATE_DIR:-${TRAKRAI_SYSTEMCTL_UNIT_DIR}/.state}"

mkdir -p "${TRAKRAI_RUNTIME_ROOT}" "${TRAKRAI_SYSTEMCTL_UNIT_DIR}" "${TRAKRAI_SYSTEMCTL_STATE_DIR}"

cleanup() {
  shopt -s nullglob
  for unit in "${TRAKRAI_SYSTEMCTL_UNIT_DIR}"/*.service; do
    systemctl stop "$(basename "${unit}")" >/dev/null 2>&1 || true
  done
}

trap cleanup EXIT INT TERM

python3 /stage/bootstrap_device_runtime.py --stage-dir /stage

mkdir -p "${TRAKRAI_RUNTIME_ROOT}/logs"
touch "${TRAKRAI_RUNTIME_ROOT}/logs/container.log"
printf 'local device emulator started at %s\n' "$(date -Iseconds)" >>"${TRAKRAI_RUNTIME_ROOT}/logs/container.log"

exec tail -F "${TRAKRAI_RUNTIME_ROOT}"/logs/*.log
