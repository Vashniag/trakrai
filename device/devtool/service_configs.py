from __future__ import annotations

import json
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import manifests, paths, schema_tools
from .configs import (
    default_webrtc_host_candidate_ip,
    generate_profile_config_map,
    merge_schema_defaults,
    patch_config_map,
    validate_config_map,
)
from .utils import deep_copy_json


@dataclass(frozen=True)
class ServiceConfigContext:
    camera_count: int
    cloud_api_access_token: str
    cloud_api_base_url: str
    device_id: str
    enable_host_audio_playback: bool
    host_audio_port: int
    mqtt_host: str
    mqtt_port: int
    webrtc_host_candidate_ip: str
    webrtc_udp_port_max: int
    webrtc_udp_port_min: int


RELEVANT_CONTEXT_CONFIGS = (
    "cloud-comm.json",
    "cloud-transfer.json",
    "live-feed.json",
    "rtsp-feeder.json",
    "audio-manager.json",
    "ai-inference.json",
)


def relevant_config_names(service_name: str) -> list[str]:
    service = manifests.require_service(service_name)
    names = list(RELEVANT_CONTEXT_CONFIGS)
    if service.config_name and service.config_name not in names:
        names.append(service.config_name)
    return names


def _parse_mqtt_broker_url(value: str) -> tuple[str, int]:
    raw = value.strip()
    if not raw:
        return "host.docker.internal", 1883
    parsed = urllib.parse.urlparse(raw)
    host = parsed.hostname or "host.docker.internal"
    port = parsed.port or 1883
    return host, port


def _detect_camera_count(config_map: dict[str, dict[str, Any]]) -> int:
    for config_name in ("rtsp-feeder.json", "cloud-comm.json", "ai-inference.json"):
        payload = config_map.get(config_name)
        if not isinstance(payload, dict):
            continue
        cameras = payload.get("cameras")
        if isinstance(cameras, list) and cameras:
            return len(cameras)
    return 1


def _detect_host_audio_port(config_map: dict[str, dict[str, Any]]) -> tuple[bool, int]:
    payload = config_map.get("audio-manager.json")
    if not isinstance(payload, dict):
        return False, paths.DEFAULT_LOCAL_AUDIO_PORT
    playback = payload.get("playback")
    if not isinstance(playback, dict):
        return False, paths.DEFAULT_LOCAL_AUDIO_PORT
    enabled = str(playback.get("backend", "")).strip() == "command"
    template = playback.get("command_template")
    if isinstance(template, list):
        for item in template:
            value = str(item).strip()
            if value.startswith("http://") or value.startswith("https://"):
                parsed = urllib.parse.urlparse(value)
                if parsed.port:
                    return enabled, parsed.port
    return enabled, paths.DEFAULT_LOCAL_AUDIO_PORT


def infer_service_config_context(config_map: dict[str, dict[str, Any]]) -> ServiceConfigContext:
    cloud_comm = config_map.get("cloud-comm.json") if isinstance(config_map.get("cloud-comm.json"), dict) else {}
    cloud_transfer = config_map.get("cloud-transfer.json") if isinstance(config_map.get("cloud-transfer.json"), dict) else {}
    live_feed = config_map.get("live-feed.json") if isinstance(config_map.get("live-feed.json"), dict) else {}

    mqtt_host, mqtt_port = _parse_mqtt_broker_url(str((cloud_comm.get("mqtt") or {}).get("broker_url", "")).strip())
    cloud_api = cloud_transfer.get("cloud_api") if isinstance(cloud_transfer.get("cloud_api"), dict) else {}
    webrtc = live_feed.get("webrtc") if isinstance(live_feed.get("webrtc"), dict) else {}
    host_candidate_ips = webrtc.get("host_candidate_ips")
    udp_port_range = webrtc.get("udp_port_range") if isinstance(webrtc.get("udp_port_range"), dict) else {}
    enable_host_audio_playback, host_audio_port = _detect_host_audio_port(config_map)

    return ServiceConfigContext(
        camera_count=_detect_camera_count(config_map),
        cloud_api_access_token=str(cloud_api.get("access_token", "")).strip(),
        cloud_api_base_url=str(cloud_api.get("base_url", "")).strip(),
        device_id=str(cloud_comm.get("device_id") or cloud_transfer.get("device_id") or paths.DEFAULT_LOCAL_DEVICE_ID).strip(),
        enable_host_audio_playback=enable_host_audio_playback,
        host_audio_port=host_audio_port,
        mqtt_host=mqtt_host,
        mqtt_port=mqtt_port,
        webrtc_host_candidate_ip=(host_candidate_ips[0] if isinstance(host_candidate_ips, list) and host_candidate_ips else default_webrtc_host_candidate_ip()),
        webrtc_udp_port_max=int(udp_port_range.get("max", paths.DEFAULT_WEBRTC_UDP_PORT_MAX) or paths.DEFAULT_WEBRTC_UDP_PORT_MAX),
        webrtc_udp_port_min=int(udp_port_range.get("min", paths.DEFAULT_WEBRTC_UDP_PORT_MIN) or paths.DEFAULT_WEBRTC_UDP_PORT_MIN),
    )


def _load_file_payload(path: str) -> dict[str, Any]:
    payload = json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"config file must contain a JSON object: {path}")
    return payload


def _load_sample_payload(service: manifests.ServiceManifest) -> dict[str, Any]:
    if service.sample_config_file is None or not service.sample_config_file.exists():
        return {}
    payload = json.loads(service.sample_config_file.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"sample config must contain a JSON object: {service.sample_config_file}")
    return payload


def _generate_profile_payload(service_name: str, profile_name: str, context: ServiceConfigContext) -> dict[str, Any]:
    profile = manifests.require_profile(profile_name)
    if service_name not in profile.services:
        raise SystemExit(f"profile {profile_name} does not include service {service_name}")
    service = manifests.require_service(service_name)
    config_map = generate_profile_config_map(
        profile_name=profile_name,
        camera_count=context.camera_count,
        cloud_mode="live" if context.cloud_api_base_url and "host.docker.internal" not in context.cloud_api_base_url else "local",
        device_id=context.device_id,
        mqtt_host=context.mqtt_host,
        mqtt_port=context.mqtt_port,
        cloud_api_base_url=context.cloud_api_base_url,
        cloud_api_access_token=context.cloud_api_access_token,
        webrtc_host_candidate_ip=context.webrtc_host_candidate_ip,
        webrtc_udp_port_min=context.webrtc_udp_port_min,
        webrtc_udp_port_max=context.webrtc_udp_port_max,
        enable_host_audio_playback=context.enable_host_audio_playback,
        host_audio_port=context.host_audio_port,
    )
    if not service.config_name or service.config_name not in config_map:
        raise SystemExit(f"profile {profile_name} did not generate config for service {service_name}")
    return config_map[service.config_name]


def _generate_sample_or_schema_payload(
    service: manifests.ServiceManifest,
    *,
    use_sample: bool,
    context: ServiceConfigContext,
) -> dict[str, Any]:
    if service.schema_file is None or not service.schema_file.exists():
        raise SystemExit(f"service {service.name} does not have a schema")
    defaults = schema_tools.generate_defaults(schema_tools.load_schema(service.name))
    override = _load_sample_payload(service) if use_sample else {}
    payload = merge_schema_defaults(defaults, override)
    if not isinstance(payload, dict):
        raise SystemExit(f"generated config payload for {service.name} must be a JSON object")
    if not service.config_name:
        return payload
    patched = patch_config_map(
        {service.config_name: payload},
        mqtt_host=context.mqtt_host,
        mqtt_port=context.mqtt_port,
        cloud_api_base_url=context.cloud_api_base_url,
        cloud_api_access_token=context.cloud_api_access_token,
        device_id=context.device_id,
        camera_count=context.camera_count,
        webrtc_host_candidate_ip=context.webrtc_host_candidate_ip,
        webrtc_udp_port_min=context.webrtc_udp_port_min,
        webrtc_udp_port_max=context.webrtc_udp_port_max,
        enable_host_audio_playback=context.enable_host_audio_playback,
        host_audio_port=context.host_audio_port,
    )
    return patched[service.config_name]


def build_service_config_payload(
    service_name: str,
    *,
    config_source: str,
    config_file: str,
    profile_name: str,
    existing_configs: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    service = manifests.require_service(service_name)
    if service.config_name is None:
        return None
    context = infer_service_config_context(existing_configs)
    resolved_source = config_source
    if resolved_source == "auto":
        if config_file:
            resolved_source = "file"
        elif service.config_name in existing_configs:
            resolved_source = "current"
        elif profile_name and service_name in manifests.require_profile(profile_name).services:
            resolved_source = "profile"
        elif service.sample_config_file and service.sample_config_file.exists():
            resolved_source = "sample"
        else:
            resolved_source = "schema"

    if resolved_source == "skip":
        return None
    if resolved_source == "current":
        if service.config_name not in existing_configs:
            raise SystemExit(f"target does not currently have {service.config_name}")
        payload = deep_copy_json(existing_configs[service.config_name])
    elif resolved_source == "file":
        if not config_file:
            raise SystemExit("--config-file is required when --config-source file")
        payload = _load_file_payload(config_file)
    elif resolved_source == "profile":
        if not profile_name:
            raise SystemExit("--profile is required when --config-source profile")
        payload = _generate_profile_payload(service_name, profile_name, context)
    elif resolved_source == "sample":
        payload = _generate_sample_or_schema_payload(service, use_sample=True, context=context)
    elif resolved_source == "schema":
        payload = _generate_sample_or_schema_payload(service, use_sample=False, context=context)
    else:
        raise SystemExit(f"unsupported config source: {resolved_source}")

    issues = validate_config_map({service.config_name: payload})
    if issues:
        raise SystemExit(json.dumps({"configName": service.config_name, "issues": issues}, indent=2))
    return payload
