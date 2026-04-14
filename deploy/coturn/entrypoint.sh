#!/bin/sh
set -eu

BASE_CONFIG_PATH="/etc/trakrai-turnserver.conf"
GENERATED_CONFIG_PATH="/tmp/trakrai-turnserver.conf"
PUBLIC_IP="${TURN_PUBLIC_IP:-}"
PRIVATE_IP="${TURN_PRIVATE_IP:-$(hostname -i | awk '{print $1}')}"

is_loopback_ip() {
  case "$1" in
    ""|"127.0.0.1"|"0.0.0.0"|"::1"|"localhost")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

cp "${BASE_CONFIG_PATH}" "${GENERATED_CONFIG_PATH}"
printf '\nlistening-ip=0.0.0.0\n' >> "${GENERATED_CONFIG_PATH}"

if ! is_loopback_ip "${PUBLIC_IP}"; then
  printf 'relay-ip=%s\n' "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"
  printf 'external-ip=%s/%s\n' "${PUBLIC_IP}" "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"
else
  echo "trakrai-coturn-entrypoint: TURN_PUBLIC_IP is not set to a reachable host IP; starting without external-ip mapping" >&2
fi

exec turnserver -c "${GENERATED_CONFIG_PATH}"
