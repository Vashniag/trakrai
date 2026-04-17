# Jetson deploy runbook (real device, cloud artifact mode)

End-to-end recipe for reflashing a Jetson-class device from a controller machine using published cloud packages. Companion to `README.md`; that file explains *what* each script does, this file captures the *operational procedure* that has been tested against a live device.

Context captured here reflects the bring-up of the `jetson-test` device at `hacklab@10.8.0.50` against the production cloud at `https://ai.trakr.live`, using the MQTT broker at `13.235.255.158:1883`.

## 0. Prerequisites on the controller

- Python 3 with `paramiko` (`pip install paramiko`).
- Network reachability to:
  - the device (SSH), typically via VPN (`10.8.0.0/24` in this deployment),
  - `https://ai.trakr.live` for package downloads.
- A local clone of this repository. No Docker build is required in cloud mode.

## 1. Collect what you will need

| Input | Example | Source |
| --- | --- | --- |
| SSH host | `10.8.0.50` | VPN address |
| SSH user / sudo password | `hacklab` / `HACK@LAB` | device inventory |
| Cloud API base URL | `https://ai.trakr.live` | ops |
| Device ID | `jetson-test` | cloud admin |
| Device access token | `trd_...` | cloud admin |
| MQTT broker URL | `tcp://13.235.255.158:1883` | ops |
| Camera RTSP URLs + ONVIF creds | `admin:HACK_LAB@192.168.1.20` etc. | site survey |
| Small YOLO model path | `yolov5s.pt` or TensorRT `.engine` | device inventory |

## 2. Snapshot and back up the device

Before any destructive change, create a timestamped backup on the device. This captures:

- the authoritative camera list (PTW `configurations/config.json` + derived `cameras.json`),
- the existing YOLO model collection,
- all systemd unit files you are about to remove,
- any legacy application scripts referenced by those units,
- a `systemctl` + `ps` snapshot so you can rebuild the old setup if needed.

```bash
# on the device, run as root
TS=$(date -u +%Y%m%dT%H%M%SZ)
BK=/home/hacklab/pre-deploy-backup-$TS
mkdir -p $BK/{configs,systemd-units,simpleton-scripts,yolo-models}

# camera config & models
cp -av /home/hacklab/git/TRAKR_AI_PTW/configurations/config*.json $BK/configs/
cp -av /home/hacklab/rtsp $BK/configs/rtsp.txt 2>/dev/null || true
python3 -c "
import json;
c=json.load(open('/home/hacklab/git/TRAKR_AI_PTW/configurations/config.json'));
json.dump(c.get('cameras',[]), open('$BK/configs/cameras.json','w'), indent=2)"
cp -av /home/hacklab/git/TRAKR_AI_PTW/deployed_models/. $BK/yolo-models/

# systemd units + legacy scripts
for u in rtsp_redis_pt file_server_service keep-presence \
         monitor_violations_service tagging_server data_monitor_service; do
  cp -av /etc/systemd/system/$u.service $BK/systemd-units/ 2>/dev/null || true
done
cp -av /root/git/TRAKR_AI_simpleton/. $BK/simpleton-scripts/
systemctl list-units --type=service --no-pager --all > $BK/systemd-units-list.txt
ps -ef > $BK/ps-snapshot.txt
chown -R hacklab:hacklab $BK
```

## 3. Tear down the legacy stack (keep Redis!)

Redis is the ingest backbone for the new stack too — never stop or reinstall it during this procedure.

```bash
# on the device, as root
for u in rtsp_redis_pt file_server_service keep-presence \
         monitor_violations_service tagging_server data_monitor_service; do
  systemctl stop    $u.service || true
  systemctl disable $u.service || true
  rm -f /etc/systemd/system/$u.service
done
tmux kill-server 2>/dev/null || true
pkill -9 -f test_rtsp_redis         || true
pkill -9 -f run_rtsp_redis_pt.sh    || true
pkill -9 -f TRAKR_AI_simpleton      || true
pkill -9 -f run_monitor_violations  || true
pkill -9 -f run_file_server_service || true
pkill -9 -f run_keep-presence       || true
pkill -9 -f run_tagging_server      || true
pkill -9 -f data_cleanup.sh         || true
systemctl daemon-reload
systemctl reset-failed
# sanity: only redis-server should remain from the trakr family
systemctl list-units --type=service --no-pager | \
  grep -Ei 'trakr|rtsp|ptz|simpleton|monitor|keep-presence|tagging|file_server|data_monitor|redis'
```

## 4. Pre-stage the YOLO model

The ai-inference config references an absolute path to the weights. Place them before running deploy so the service finds them on first start:

```bash
# on the device, as root
mkdir -p /home/hacklab/trakrai-device-runtime/models
cp -av $BK/yolo-models/yolov5s.pt       /home/hacklab/trakrai-device-runtime/models/yolov5s.pt
cp -av $BK/yolo-models/yolov5s.engine.bak_batch1 \
       /home/hacklab/trakrai-device-runtime/models/yolov5s.engine
chown -R hacklab:hacklab /home/hacklab/trakrai-device-runtime
```

The bootstrap installer only touches the entries listed in `legacy_backup_names` (see `device_runtime_common.py`) — `models` is not in that list, so pre-staged weights survive a deploy.

## 5. Author the per-device config set on the controller

Create a directory (e.g. `device/.deploy-jetson-test/configs/`) with one JSON per service you want to bring up. Minimum required services are `cloud-comm` and whatever you will actually use.

Real-world values that have to match the target:

- **`cloud-comm.json`** &mdash; `device_id`, `mqtt.broker_url`, `edge.listen_addr`, and `edge.allowed_origins` for the device's LAN/VPN IPs.
- **`cloud-transfer.json`** &mdash; `device_id`, `cloud_api.base_url`, and `cloud_api.access_token` (device-scoped `trd_…` token).
- **`rtsp-feeder.json`** &mdash; one camera entry per live RTSP stream, pointing at the real camera IPs. Include the Redis password if Redis is secured (`HACKLAB3008` on this device).
- **`ptz-control.json`** &mdash; per camera: `address` (camera IP, **not** `host`), `onvif_port` (80), `username`, `password`, `driver: "onvif"`. See `device/internal/ptzcontrol/config.go` for the validator — the required field is `address`, not `host`, which is the single most common cause of `missing address` restart loops.
- **`live-feed.json`** &mdash; `redis` credentials; set `webrtc.host_candidate_ips` to the device's VPN IP so browsers on the operator side can peer with it.
- **`ai-inference.json`** &mdash; `inference.models[].weights_path` should point at the file pre-staged in step 4.
- **`video-recorder.json`** &mdash; tighten `buffer.max_bytes_per_camera` and `max_frames_per_camera` to match the SD card budget (the 14 GB eMMC on the Jetson fills quickly at the defaults; 64 MiB per camera, 1500 frames, 120 s is a sane starting point).

## 6. Run the deploy from the controller

```bash
python device/scripts/deploy_device_runtime.py \
  --host 10.8.0.50 --user hacklab --password 'HACK@LAB' \
  --config-dir device/.deploy-jetson-test/configs \
  --artifact-source cloud \
  --artifact-platform linux/arm64 \
  --cloud-api-base-url https://ai.trakr.live \
  --cloud-api-token  trd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --device-id jetson-test \
  --transport-mode edge --start-mode all \
  --keep-stage
```

What happens:

1. Configs are loaded from `--config-dir` (or fetched from the device if omitted).
2. Artifacts are pulled from `https://ai.trakr.live` based on `device/package-versions.json`. Go binaries arrive as `<name>-linux-arm64-v<version>`; wheels arrive as `.whl`; the UI as a `.zip`. Wheelhouse dependencies are resolved with a target-architecture `pip download`.
3. The stage directory is uploaded via SFTP to `/tmp/trakrai-bootstrap-<timestamp>/`.
4. `bootstrap_device_runtime.py` runs as root on the device: stops the old units, creates `/home/hacklab/trakrai-device-runtime/`, installs binaries/configs/UI/wheels, writes the `trakrai-runtime-manager.service` unit, and waits for the runtime manager to materialize the per-service units.
5. The deploy script re-runs a verification SSH command to dump unit states and key directory listings.

## 7. Post-deploy verification

From the controller:

```bash
curl -s http://10.8.0.50:8080/api/runtime-config | jq
```

Expect `transportMode: "edge"` and the device ID you passed. Browsing `http://10.8.0.50:8080/` serves the edge UI.

On the device, logs live under `/home/hacklab/trakrai-device-runtime/logs/*.log`. Key checks:

- `cloud-comm.log` &mdash; `connected to broker tcp://<mqtt-host>:1883` and no continuous `heartbeat publish failed`.
- `rtsp-feeder.log` &mdash; `pipeline active, first frame received` for each camera, followed by `frame milestone` every 100 frames. The HW pipeline on the Jetson is `H.265 HW`.
- `ptz-control.log` &mdash; `trakrai ptz-control ready cameras="..."` followed by ONVIF RPC debug lines (`GetProfiles 200 OK`, `GetStatus 200 OK`) on the cameras that use the `onvif` driver.

## 8. Known pitfalls from the first live bring-up

1. **ONVIF IP drift.** The PTW `configurations/config.json` had each camera's `speaker_address` / old management IP (e.g. `192.168.1.35`) listed separately from the RTSP IP (`192.168.1.20`). On the current site the cameras run both RTSP and ONVIF on the same address, so the PTZ config should use the RTSP camera IPs as `address`. The old management IP was unreachable (`100% packet loss`) and made the service restart in a `missing address` loop. Always cross-check with `nc -zv <ip> 80` + a `GetSystemDateAndTime` SOAP probe before trusting the inventory.
2. **Wrong MQTT IP.** A typo (`13.255.255.158` vs `13.235.255.158`) looks innocuous but manifests as steady `mqtt connect timed out` every 30 s. Verify with `nc -zv 13.235.255.158 1883` from the device; a working port will respond in <1 s. Note that `test.mosquitto.org:1883` is usually reachable and a good way to rule out local egress blocks.
3. **eMMC disk pressure.** The default video-recorder ring buffer (256 MiB × N cameras) plus old tarballs (`go1.25.3.linux-arm64.tar.gz`, 55 MiB) plus the legacy EasyOCR cache will trip `No space left on device` while writing config files. Clear `/home/hacklab/go1.25.3.linux-arm64.tar.gz`, `/tmp/trakrai-bootstrap-*`, and tighten `video-recorder.json` before starting the recorder.
4. **PTZ verify race.** On cold boot ONVIF peers can take >10 s to answer; early versions of `verify_units` failed the deploy because ptz-control was still `activating`. The installer now re-probes for up to 20 s before declaring failure.
5. **Stale cloud bridge URL.** The `--cloud-bridge-url` default used to be a hard-coded VPN host. It is now empty; when empty, the edge UI keeps whatever `cloud_bridge_url` already exists on the device or falls back to `ws://<host>:<http-port>/ws`. Pass the flag only when you genuinely want to change it.

## 9. Roll back

Because step 2 preserves the legacy units and scripts, a full rollback looks like:

```bash
# on the device, as root
for u in rtsp_redis_pt file_server_service keep-presence \
         monitor_violations_service tagging_server data_monitor_service; do
  cp $BK/systemd-units/$u.service /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable rtsp_redis_pt file_server_service keep-presence \
                 monitor_violations_service tagging_server data_monitor_service
systemctl stop 'trakrai-*'
systemctl disable 'trakrai-*'
rm -f /etc/systemd/system/trakrai-*.service
```

Redis is untouched by either direction, so no action is needed on it.
