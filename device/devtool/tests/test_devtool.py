from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from device.devtool import cli, manifests, paths, schema_tools, services, stage
from device.devtool.configs import generate_profile_config_map
from device.devtool.python_support import iter_python_runtime_support_files
from device.devtool.service_definitions import RuntimeLayout
from device.devtool.service_targets import LocalArtifactReference, RemoteArtifactReference
from device.devtool.websocket_client import SimpleWebSocketClient, WebSocketFrame


class DevtoolManifestTests(unittest.TestCase):
    def test_profiles_and_tests_are_loaded(self) -> None:
        self.assertIn("local-emulator-all", manifests.profiles_by_name())
        self.assertIn("cloud-transfer-local", manifests.tests_by_name())

    def test_cloud_transfer_requires_cloud_api_component_closure(self) -> None:
        required = manifests.required_components_for_services(["cloud-transfer"])
        self.assertIn("cloud-api", required)
        self.assertIn("minio", required)

    def test_generate_profile_config_map_clones_cameras(self) -> None:
        config_map = generate_profile_config_map(
            profile_name="local-emulator-all",
            camera_count=3,
            cloud_mode="local",
            device_id="trakrai-device-local",
            mqtt_host="host.docker.internal",
            mqtt_port=1883,
            cloud_api_base_url="http://host.docker.internal:3000",
            cloud_api_access_token="",
            webrtc_host_candidate_ip="127.0.0.1",
            webrtc_udp_port_min=40000,
            webrtc_udp_port_max=40049,
            enable_host_audio_playback=False,
            host_audio_port=18920,
        )
        cameras = config_map["rtsp-feeder.json"]["cameras"]
        self.assertEqual(3, len(cameras))
        self.assertEqual("Camera-3", cameras[2]["name"])
        self.assertEqual("rtsp://fake-camera:8554/stream3", cameras[2]["rtsp_url"])

    def test_generate_profile_config_map_respects_profile_service_subset(self) -> None:
        config_map = generate_profile_config_map(
            profile_name="local-emulator-core",
            camera_count=1,
            cloud_mode="local",
            device_id="trakrai-device-local",
            mqtt_host="host.docker.internal",
            mqtt_port=1883,
            cloud_api_base_url="http://host.docker.internal:3000",
            cloud_api_access_token="",
            webrtc_host_candidate_ip="127.0.0.1",
            webrtc_udp_port_min=40000,
            webrtc_udp_port_max=40049,
            enable_host_audio_playback=False,
            host_audio_port=18920,
        )
        self.assertEqual({"cloud-comm.json", "runtime-manager.json"}, set(config_map))
        self.assertEqual("trakrai-device-local", config_map["cloud-comm.json"]["device_id"])
        self.assertEqual("runtime-manager", config_map["cloud-comm.json"]["edge"]["ui"]["management_service"])

    def test_audio_manager_sample_validates_against_generated_schema(self) -> None:
        service = manifests.require_service("audio-manager")
        sample_payload = json.loads(service.sample_config_file.read_text(encoding="utf-8"))
        issues = schema_tools.validate_service_config("audio-manager", sample_payload)
        self.assertEqual([], issues)

    def test_runtime_manager_sample_validates_against_generated_schema(self) -> None:
        service = manifests.require_service("runtime-manager")
        sample_payload = json.loads(service.sample_config_file.read_text(encoding="utf-8"))
        issues = schema_tools.validate_service_config("runtime-manager", sample_payload)
        self.assertEqual([], issues)

    def test_stage_manifest_includes_generated_python_configs(self) -> None:
        service = manifests.require_service("audio-manager")
        with tempfile.TemporaryDirectory() as tmp_dir:
            artifact_path = Path(tmp_dir) / "trakrai_audio_manager-0.1.0-py3-none-any.whl"
            artifact_path.write_bytes(b"wheel")
            manifest = stage.build_stage_manifest(
                stage.StageOptions(),
                [service],
                {service.name: artifact_path},
            )
        python_packages = {item["target_dir"] for item in manifest["python_packages"]}
        self.assertIn("python/trakrai_service_runtime", python_packages)
        self.assertIn("python/generated_configs", python_packages)

    def test_stage_manifest_omits_python_support_for_go_only_runtime(self) -> None:
        service = manifests.require_service("cloud-comm")
        with tempfile.TemporaryDirectory() as tmp_dir:
            artifact_path = Path(tmp_dir) / "cloud-comm"
            artifact_path.write_bytes(b"binary")
            manifest = stage.build_stage_manifest(
                stage.StageOptions(),
                [service],
                {service.name: artifact_path},
            )
        self.assertEqual([], manifest["python_packages"])
        self.assertEqual([], manifest["python_path_entries"])

    def test_copy_selected_python_support_only_copies_needed_generated_modules(self) -> None:
        audio_manager = manifests.require_service("audio-manager")
        with tempfile.TemporaryDirectory() as tmp_dir:
            python_dir = Path(tmp_dir)
            stage.copy_selected_python_support([audio_manager], python_dir)
            generated_dir = python_dir / "generated_configs"
            copied = sorted(path.name for path in generated_dir.glob("*.py"))
        self.assertEqual(["__init__.py", "_runtime.py", "audio_manager.py"], copied)

    def test_manifest_config_languages_match_service_kind(self) -> None:
        for service in manifests.load_services():
            if service.is_go_binary:
                self.assertEqual(("go",), service.config_languages)
            elif service.is_python:
                self.assertEqual(("python",), service.config_languages)
            elif service.is_ui_bundle:
                self.assertEqual((), service.config_languages)

    def test_codegen_prunes_stale_outputs_for_undeclared_services(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            go_root = temp_root / "go"
            py_root = temp_root / "py"
            go_root.mkdir()
            py_root.mkdir()
            stale_go = go_root / "legacy_service.go"
            valid_go = go_root / "cloud_comm.go"
            stale_py = py_root / "legacy_service.py"
            valid_py = py_root / "audio_manager.py"
            runtime_py = py_root / "_runtime.py"
            init_py = py_root / "__init__.py"
            for path in (stale_go, valid_go, stale_py, valid_py, runtime_py, init_py):
                path.write_text("# test\n", encoding="utf-8")

            original_go_root = paths.GO_GENERATED_CONFIG_ROOT
            original_py_root = paths.PYTHON_GENERATED_CONFIG_ROOT
            paths.GO_GENERATED_CONFIG_ROOT = go_root
            paths.PYTHON_GENERATED_CONFIG_ROOT = py_root
            try:
                written, deleted = schema_tools.write_codegen(
                    go_services=[],
                    python_services=[],
                    declared_go_services=["cloud-comm"],
                    declared_python_services=["audio-manager"],
                )
            finally:
                paths.GO_GENERATED_CONFIG_ROOT = original_go_root
                paths.PYTHON_GENERATED_CONFIG_ROOT = original_py_root

            self.assertEqual([], written)
            self.assertIn(stale_go, deleted)
            self.assertIn(stale_py, deleted)
            self.assertTrue(valid_go.exists())
            self.assertTrue(valid_py.exists())
            self.assertTrue(runtime_py.exists())
            self.assertTrue(init_py.exists())
            self.assertFalse(stale_go.exists())
            self.assertFalse(stale_py.exists())


class WebsocketClientTests(unittest.TestCase):
    def test_receive_text_reassembles_fragmented_frames(self) -> None:
        client = object.__new__(SimpleWebSocketClient)
        frames = iter(
            [
                WebSocketFrame(fin=False, opcode=0x1, payload=b'{"message":"hello '),
                WebSocketFrame(fin=True, opcode=0x0, payload=b'world"}'),
            ]
        )
        client._read_frame = lambda: next(frames)  # type: ignore[method-assign]
        self.assertEqual('{"message":"hello world"}', client.receive_text())


def runtime_message(message_type: str, payload: dict[str, object], *, service: str = "runtime-manager") -> dict[str, object]:
    return {
        "service": service,
        "subtopic": "response",
        "envelope": {
            "type": message_type,
            "payload": payload,
        },
    }


class FakeRuntimeClient:
    def __init__(self) -> None:
        self.put_config_calls: list[dict[str, object]] = []
        self.put_runtime_file_calls: list[dict[str, object]] = []
        self.upsert_calls: list[dict[str, object]] = []
        self.update_calls: list[dict[str, object]] = []
        self.service_action_calls: list[tuple[str, str]] = []

    def close(self) -> None:
        return

    def get_status(self, *, timeout_sec: float | None = None) -> dict[str, object]:
        del timeout_sec
        return runtime_message(
            "runtime-manager-status",
            {
                "binaryDir": "/home/hacklab/trakrai-device-runtime/bin",
                "configDir": "/home/hacklab/trakrai-device-runtime/configs",
                "downloadDir": "/home/hacklab/trakrai-device-runtime/downloads",
                "generatedAt": "2026-04-18T00:00:00Z",
                "logDir": "/home/hacklab/trakrai-device-runtime/logs",
                "scriptDir": "/home/hacklab/trakrai-device-runtime/scripts",
                "sharedDir": "/home/hacklab/trakrai-device-runtime/shared",
                "services": [
                    {"name": "cloud-comm"},
                    {"name": "runtime-manager"},
                ],
                "versionDir": "/home/hacklab/trakrai-device-runtime/versions",
            },
        )

    def get_service_definition(self, service_name: str, *, timeout_sec: float | None = None) -> dict[str, object]:
        del timeout_sec
        if service_name == "cloud-comm":
            return runtime_message(
                "runtime-manager-service-definition",
                {
                    "serviceName": "cloud-comm",
                    "definition": {
                        "name": "cloud-comm",
                        "user": "hacklab",
                        "group": "hacklab",
                    },
                },
            )
        return runtime_message(
            "runtime-manager-error",
            {
                "serviceName": service_name,
                "error": f'managed service "{service_name}" is not configured',
            },
        )

    def get_config(self, config_name: str, *, timeout_sec: float | None = None) -> dict[str, object]:
        del timeout_sec
        return runtime_message(
            "runtime-manager-error",
            {
                "configName": config_name,
                "error": f"config {config_name} does not exist",
            },
        )

    def put_config(
        self,
        config_name: str,
        content: object,
        *,
        create_if_missing: bool,
        restart_services: list[str] | None = None,
        timeout_sec: float | None = None,
    ) -> dict[str, object]:
        del timeout_sec
        self.put_config_calls.append(
            {
                "config_name": config_name,
                "content": content,
                "create_if_missing": create_if_missing,
                "restart_services": list(restart_services or []),
            }
        )
        return runtime_message(
            "runtime-manager-config",
            {
                "config": {
                    "name": config_name,
                    "path": f"/home/hacklab/trakrai-device-runtime/configs/{config_name}",
                },
                "content": content,
            },
        )

    def upsert_service(self, definition: dict[str, object], *, timeout_sec: float | None = None) -> dict[str, object]:
        del timeout_sec
        self.upsert_calls.append(definition)
        return runtime_message(
            "runtime-manager-service-action",
            {
                "action": "upsert-service",
                "serviceName": definition["name"],
                "definition": definition,
            },
        )

    def put_runtime_file(
        self,
        path: str,
        content: str,
        *,
        mode: int = 0o644,
        timeout_sec: float | None = None,
    ) -> dict[str, object]:
        del timeout_sec
        self.put_runtime_file_calls.append(
            {
                "path": path,
                "content": content,
                "mode": mode,
            }
        )
        return runtime_message(
            "runtime-manager-file",
            {
                "path": path,
                "mode": mode,
                "message": f"saved runtime file {path}",
            },
        )

    def update_service(
        self,
        service_name: str,
        *,
        remote_path: str = "",
        local_path: str = "",
        artifact_sha256: str = "",
        timeout_sec: float | None = None,
    ) -> dict[str, object]:
        del timeout_sec
        self.update_calls.append(
            {
                "service_name": service_name,
                "remote_path": remote_path,
                "local_path": local_path,
                "artifact_sha256": artifact_sha256,
            }
        )
        return runtime_message(
            "runtime-manager-update",
            {
                "action": "update-service",
                "serviceName": service_name,
                "message": "updated",
            },
        )

    def service_action(self, action: str, service_name: str, *, timeout_sec: float | None = None) -> dict[str, object]:
        del timeout_sec
        self.service_action_calls.append((action, service_name))
        return runtime_message(
            "runtime-manager-service-action",
            {
                "action": action,
                "serviceName": service_name,
            },
        )


class ServicePushTests(unittest.TestCase):
    def test_cli_surface_includes_service_command(self) -> None:
        self.assertIn("service", cli.DELEGATED_COMMANDS)

    def test_resolve_runtime_url_defaults_by_target(self) -> None:
        self.assertEqual("ws://127.0.0.1:18080/ws", services.resolve_runtime_url("emulator", ""))
        self.assertEqual("ws://127.0.0.1:8080/ws", services.resolve_runtime_url("ssh", ""))
        self.assertEqual("ws://example.test/ws", services.resolve_runtime_url("runtime", "ws://example.test/ws"))
        self.assertEqual(
            "http://127.0.0.1:3000",
            services.normalize_host_cloud_api_base_url("http://host.docker.internal:3000"),
        )

    def test_service_push_emulator_creates_missing_service_and_starts_it(self) -> None:
        fake_runtime = FakeRuntimeClient()
        service = manifests.require_service("audio-manager")
        with tempfile.TemporaryDirectory() as tmp_dir:
            artifact_path = Path(tmp_dir) / "audio-manager-0.1.0-py3-none-any.whl"
            artifact_path.write_bytes(b"wheel")
            parser = services.build_parser()
            args = parser.parse_args(["push", "--service", service.name, "--target", "emulator"])
            with (
                mock.patch.object(services, "RuntimeWsClient", return_value=fake_runtime),
                mock.patch.object(services, "resolve_local_artifact", return_value=artifact_path),
                mock.patch.object(services, "build_service_config_payload", return_value={"log_level": "info"}),
                mock.patch.object(
                    services,
                    "copy_artifact_to_local_runtime",
                    return_value=LocalArtifactReference(
                        local_path=Path("/home/hacklab/trakrai-device-runtime/shared/package-downloads/audio-manager/audio-manager.whl"),
                        sha256="abc123",
                    ),
                ),
            ):
                result = args.func(args)

        self.assertEqual(0, result)
        self.assertEqual(
            [
                {
                    "config_name": "audio-manager.json",
                    "content": {"log_level": "info"},
                    "create_if_missing": True,
                    "restart_services": [],
                }
            ],
            fake_runtime.put_config_calls,
        )
        self.assertEqual(2, len(fake_runtime.upsert_calls))
        self.assertFalse(bool(fake_runtime.upsert_calls[0]["enabled"]))
        self.assertTrue(bool(fake_runtime.upsert_calls[1]["enabled"]))
        self.assertEqual("/home/hacklab/trakrai-device-runtime/wheels/audio-manager", fake_runtime.upsert_calls[1]["installPath"])
        runtime_support_targets = {item["path"] for item in fake_runtime.put_runtime_file_calls}
        self.assertIn(
            "/home/hacklab/trakrai-device-runtime/python/generated_configs/audio_manager.py",
            runtime_support_targets,
        )
        self.assertIn(
            "/home/hacklab/trakrai-device-runtime/python/trakrai_service_runtime/__init__.py",
            runtime_support_targets,
        )
        self.assertEqual(
            [
                {
                    "service_name": "audio-manager",
                    "remote_path": "",
                    "local_path": "/home/hacklab/trakrai-device-runtime/shared/package-downloads/audio-manager/audio-manager.whl",
                    "artifact_sha256": "abc123",
                }
            ],
            fake_runtime.update_calls,
        )
        self.assertEqual([("start", "audio-manager")], fake_runtime.service_action_calls)

    def test_service_push_runtime_uses_published_remote_artifact(self) -> None:
        fake_runtime = FakeRuntimeClient()
        service = manifests.require_service("audio-manager")
        with tempfile.TemporaryDirectory() as tmp_dir:
            artifact_path = Path(tmp_dir) / "audio-manager-0.1.0-py3-none-any.whl"
            artifact_path.write_bytes(b"wheel")
            parser = services.build_parser()
            args = parser.parse_args(["push", "--service", service.name, "--target", "runtime"])
            with (
                mock.patch.object(services, "RuntimeWsClient", return_value=fake_runtime),
                mock.patch.object(services, "resolve_local_artifact", return_value=artifact_path),
                mock.patch.object(services, "build_service_config_payload", return_value={"log_level": "info"}),
                mock.patch.object(services, "resolve_cloud_api_base_url", return_value="http://127.0.0.1:3000"),
                mock.patch.object(services, "resolve_cloud_api_token", return_value=""),
                mock.patch.object(
                    services,
                    "publish_dev_artifact",
                    return_value=RemoteArtifactReference(
                        remote_path="dev-service-updates/audio-manager/linux-arm64/audio-manager.whl",
                        sha256="deadbeef",
                    ),
                ),
            ):
                result = args.func(args)

        self.assertEqual(0, result)
        runtime_support_targets = {item["path"] for item in fake_runtime.put_runtime_file_calls}
        self.assertIn(
            "/home/hacklab/trakrai-device-runtime/python/generated_configs/audio_manager.py",
            runtime_support_targets,
        )
        self.assertEqual(
            [
                {
                    "service_name": "audio-manager",
                    "remote_path": "dev-service-updates/audio-manager/linux-arm64/audio-manager.whl",
                    "local_path": "",
                    "artifact_sha256": "deadbeef",
                }
            ],
            fake_runtime.update_calls,
        )

    def test_iter_python_runtime_support_files_includes_generated_module(self) -> None:
        layout = RuntimeLayout(
            runtime_root="/home/hacklab/trakrai-device-runtime",
            binary_dir="/home/hacklab/trakrai-device-runtime/bin",
            config_dir="/home/hacklab/trakrai-device-runtime/configs",
            download_dir="/home/hacklab/trakrai-device-runtime/downloads",
            log_dir="/home/hacklab/trakrai-device-runtime/logs",
            script_dir="/home/hacklab/trakrai-device-runtime/scripts",
            shared_dir="/home/hacklab/trakrai-device-runtime/shared",
            version_dir="/home/hacklab/trakrai-device-runtime/versions",
            default_user="hacklab",
            default_group="hacklab",
        )
        service = manifests.require_service("trakrai-ai-inference")
        support_files = iter_python_runtime_support_files(service, layout)
        target_paths = {item.target_path for item in support_files}
        self.assertIn(
            "/home/hacklab/trakrai-device-runtime/python/generated_configs/trakrai_ai_inference.py",
            target_paths,
        )
        self.assertIn(
            "/home/hacklab/trakrai-device-runtime/python/trakrai_service_runtime/src/config_support.py",
            target_paths,
        )


if __name__ == "__main__":
    unittest.main()
