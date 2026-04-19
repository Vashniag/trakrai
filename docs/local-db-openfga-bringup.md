# Local Postgres + OpenFGA Bringup

This runbook brings up the local authorization backing stack used by the cloud app:

- Postgres on `localhost:5439`
- OpenFGA HTTP on `localhost:8080`
- OpenFGA gRPC on `localhost:8081`

Use this when:

- moving off the production database
- resetting local authz state
- starting a fresh machine
- testing manifest-driven device app permission sync

Repository root assumed for every command below.

---

## 1. Prerequisites

Need:

- Docker + Docker Compose
- Node.js 20+
- pnpm

Quick check:

```bash
docker --version
docker compose version
node --version
pnpm --version
```

---

## 2. Confirm local env values

The app reads local DB and OpenFGA settings from:

- `web/apps/trakrai/.env`

These values must point at the local stack:

```ini
DATABASE_URL=postgres://trakrai:trakrai-local-dev@localhost:5439/trakrai
OPENFGA_API_URL=http://localhost:8080
OPENFGA_STORE_NAME=trakrai
```

If these values drift, fix them first.

---

## 3. Optional: wipe old local volumes

Use this only when you want a completely fresh local stack.

```bash
docker compose -f deploy/docker-compose.yml down -v
```

This removes:

- local Postgres data
- local OpenFGA backing tables inside Postgres

Use plain `down` instead if you want to stop containers but keep data:

```bash
docker compose -f deploy/docker-compose.yml down
```

---

## 4. Start Postgres + OpenFGA

Bring up only the local authz backing services:

```bash
docker compose -f deploy/docker-compose.yml up -d postgres openfga
```

What happens:

- `postgres` starts on host port `5439`
- `openfga-migrate` runs once against Postgres
- `openfga` starts after migration completes

Note:

- compose may warn about `APP_DOMAIN` and `ACME_EMAIL`
- safe to ignore for this flow
- those vars belong to optional TLS services, not Postgres/OpenFGA

---

## 5. Verify containers

Check container state:

```bash
docker compose -f deploy/docker-compose.yml ps postgres openfga openfga-migrate
```

Expected shape:

- `postgres` is `Up` and `healthy`
- `openfga` is `Up`
- `openfga-migrate` has exited successfully

Health check OpenFGA:

```bash
curl -i http://localhost:8080/healthz
```

Expected response:

```text
HTTP/1.1 200 OK
...
{"status":"SERVING"}
```

If startup looks wrong, inspect logs:

```bash
docker compose -f deploy/docker-compose.yml logs --tail=50 postgres openfga-migrate openfga
```

---

## 6. Apply app schema to local Postgres

Run Drizzle migrations:

```bash
pnpm --dir web --filter trakrai db:migrate
```

This creates the cloud app tables in the local Postgres instance.

---

## 7. Bootstrap local auth + manifest-driven device app catalog

Run the shared bootstrap script:

```bash
pnpm --dir web db:bootstrap-local
```

App-local alias also works:

```bash
pnpm --dir web --filter trakrai db:bootstrap-local
```

What this script does:

- upserts local sysadmin user
- reads device app definitions from:
  - `device/manifests/services.json`
  - `device/manifests/service-methods.json`
- syncs `device_component_catalog`
- syncs missing `device_component_installation` rows for existing devices
- ensures OpenFGA parent tuples for installed device components

Current local sysadmin defaults:

- email: `vashni@hacklab.solutions`
- password: `HACK@LAB`

You can override with env vars before running:

```bash
LOCAL_SYSADMIN_EMAIL=...
LOCAL_SYSADMIN_PASSWORD=...
LOCAL_SYSADMIN_NAME=...
pnpm --dir web db:bootstrap-local
```

---

## 8. Force-create OpenFGA store + authorization model

Important:

- OpenFGA datastore tables come from compose migration
- OpenFGA store + auth model are created lazily by backend code

If you want to force-create them immediately on a fresh stack, run:

```bash
cd web
node --env-file=apps/trakrai/.env --import tsx -e "import { ensureAuthzState } from './packages/core/trakrai-backend/src/lib/authz/index.ts'; const run = async () => { const state = await ensureAuthzState(); console.log(JSON.stringify({ storeId: state.storeId, authorizationModelId: state.authorizationModelId }, null, 2)); }; void run().catch((error) => { console.error(error); process.exitCode = 1; });"
```

Then verify store exists:

```bash
curl http://localhost:8080/stores
```

Expected:

- JSON response containing store name `trakrai`

---

## 9. Normal local bringup sequence

From a fresh machine or wiped stack, normal sequence is:

```bash
docker compose -f deploy/docker-compose.yml up -d postgres openfga
pnpm --dir web --filter trakrai db:migrate
pnpm --dir web db:bootstrap-local
```

If you want OpenFGA store/model created immediately even before first authz write:

```bash
cd web
node --env-file=apps/trakrai/.env --import tsx -e "import { ensureAuthzState } from './packages/core/trakrai-backend/src/lib/authz/index.ts'; const run = async () => { const state = await ensureAuthzState(); console.log(JSON.stringify({ storeId: state.storeId, authorizationModelId: state.authorizationModelId }, null, 2)); }; void run().catch((error) => { console.error(error); process.exitCode = 1; });"
```

---

## 10. Quick sanity checks

Check app can see correct endpoints:

```bash
grep -E 'DATABASE_URL|OPENFGA_API_URL|OPENFGA_STORE_NAME' web/apps/trakrai/.env
```

Check OpenFGA health:

```bash
curl http://localhost:8080/healthz
```

Check local store list:

```bash
curl http://localhost:8080/stores
```

Re-run catalog sync after manifest changes:

```bash
pnpm --dir web db:bootstrap-local
```

That is the command to use after changing:

- service definitions
- cloud app route metadata
- read/write permission method lists

---

## 11. Common failure cases

### Port `5439` already in use

Something else already owns the local Postgres port.

Check:

```bash
lsof -i :5439
```

Fix:

- stop conflicting process
- or change host port mapping in `deploy/docker-compose.yml`
- then update `DATABASE_URL`

### Port `8080` already in use

Same story for OpenFGA HTTP port.

Check:

```bash
lsof -i :8080
```

Fix:

- stop conflicting process
- or remap host port in compose
- then update `OPENFGA_API_URL`

### `openfga-migrate` fails

Usually bad Postgres credentials or stale broken volume.

Check:

```bash
docker compose -f deploy/docker-compose.yml logs --tail=100 openfga-migrate postgres
```

Then either:

- fix env mismatch
- or wipe and restart with `down -v`

### Bootstrap script runs but `/stores` is empty

Possible when:

- local DB has no devices yet
- script had no OpenFGA writes to perform

Run the force-init command from step 8.
