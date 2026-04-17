from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from device.devtool import manifests, paths, schema_tools, stage
from device.devtool.configs import generate_profile_config_map
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
        self.assertEqual("rtsp://fake-camera:8554/stream", cameras[2]["rtsp_url"])

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


if __name__ == "__main__":
    unittest.main()
