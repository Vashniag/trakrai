from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEVICE_ROOT = REPO_ROOT / "device"
WEB_ROOT = REPO_ROOT / "web"
DEVICE_PYTHON_ROOT = DEVICE_ROOT / "python"
DEVICE_CONFIGS_ROOT = DEVICE_ROOT / "configs"
CONFIG_SCHEMA_ROOT = DEVICE_ROOT / "config-schemas" / "services"
MANIFEST_ROOT = DEVICE_ROOT / "manifests"
SERVICES_MANIFEST_PATH = MANIFEST_ROOT / "services.json"
SERVICE_METHODS_MANIFEST_PATH = MANIFEST_ROOT / "service-methods.json"
COMPONENTS_MANIFEST_PATH = MANIFEST_ROOT / "components.json"
PROFILES_ROOT = MANIFEST_ROOT / "profiles"
TESTS_ROOT = MANIFEST_ROOT / "tests"
DEVICE_DOCS_ROOT = DEVICE_ROOT / "docs"
LOCALDEV_ROOT = DEVICE_ROOT / ".localdev"
LOCALDEV_STAGE_ROOT = LOCALDEV_ROOT / "stage"
LOCALDEV_SHARED_ROOT = LOCALDEV_ROOT / "shared"
LOCALDEV_GENERATED_CONFIG_ROOT = LOCALDEV_ROOT / "generated-configs"
LOCALDEV_COMPOSE_ENV = LOCALDEV_ROOT / "compose.env"
LOCALDEV_COMPOSE_FILE = DEVICE_ROOT / "localdev" / "docker-compose.yml"
LOCALDEV_CONFIGS_ROOT = DEVICE_ROOT / "localdev" / "configs"
LOCALDEV_CLOUD_CONFIGS_ROOT = DEVICE_ROOT / "localdev" / "configs-cloud-emulator"
LOCALDEV_WORKFLOW_ROOT = DEVICE_ROOT / "localdev" / "workflows"
LOCALDEV_AUDIO_ROOT = DEVICE_ROOT / "localdev" / "audio"
LOCALDEV_ROI_ROOT = DEVICE_ROOT / "localdev" / "roi"
DEVTOOL_RUNTIME_ASSETS_ROOT = DEVICE_ROOT / "devtool" / "device_side"
DEVTOOL_TOOLS_ROOT = DEVICE_ROOT / "devtool" / "tools"
PACKAGE_METADATA_PATH = DEVICE_ROOT / "package-versions.json"
GO_GENERATED_CONFIG_ROOT = DEVICE_ROOT / "internal" / "generatedconfig"
GO_GENERATED_SERVICE_CONTRACT_ROOT = DEVICE_ROOT / "internal" / "ipc" / "contracts"
PYTHON_GENERATED_CONFIG_ROOT = DEVICE_PYTHON_ROOT / "generated_configs"
PYTHON_GENERATED_SERVICE_CONTRACT_ROOT = (
    DEVICE_PYTHON_ROOT / "trakrai_service_runtime" / "src" / "generated_contracts"
)
WEB_DEVICE_APP_ROOT = WEB_ROOT / "apps" / "trakrai-device"

DEFAULT_RUNTIME_ROOT = "/home/hacklab/trakrai-device-runtime"
DEFAULT_RUNTIME_USER = "hacklab"
DEFAULT_RUNTIME_GROUP = "hacklab"
DEFAULT_UNIT_DIRECTORY = f"{DEFAULT_RUNTIME_ROOT}/units"
DEFAULT_LOCAL_HTTP_PORT = 18080
DEFAULT_LOCAL_RTSP_PORT = 8554
DEFAULT_LOCAL_AUDIO_PORT = 28920
DEFAULT_WEBRTC_UDP_PORT_MIN = 40000
DEFAULT_WEBRTC_UDP_PORT_MAX = 40049
DEFAULT_LOCAL_DEVICE_ID = "trakrai-device-local"
DEFAULT_ARM64_PLATFORM = "linux/arm64"
DEFAULT_PACKAGE_PREFIX = "device-packages"
