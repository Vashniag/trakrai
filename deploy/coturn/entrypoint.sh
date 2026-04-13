#!/bin/sh
set -eu

BASE_CONFIG_PATH="/etc/trakrai-turnserver.conf"
GENERATED_CONFIG_PATH="/tmp/trakrai-turnserver.conf"
PUBLIC_IP="${TURN_PUBLIC_IP:-127.0.0.1}"
PRIVATE_IP="${TURN_PRIVATE_IP:-$(hostname -i | awk '{print $1}')}"

cp "${BASE_CONFIG_PATH}" "${GENERATED_CONFIG_PATH}"
printf '\nlistening-ip=0.0.0.0\n' >> "${GENERATED_CONFIG_PATH}"
printf 'relay-ip=%s\n' "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"
printf 'external-ip=%s/%s\n' "${PUBLIC_IP}" "${PRIVATE_IP}" >> "${GENERATED_CONFIG_PATH}"

exec turnserver -c "${GENERATED_CONFIG_PATH}"
