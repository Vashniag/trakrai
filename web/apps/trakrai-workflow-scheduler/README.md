# Scheduler Service

Background service that schedules and triggers flow runs based on cron trigger data served by the
web app.

## Responsibilities

- Expose an internal HTTP API for cron trigger upsert/delete operations.
- Fetch active cron triggers from the web app and reconcile BullMQ schedulers on startup and on an interval.
- Trigger the cron trigger HTTP endpoint (`POST /api/plugins/trigger/cron`) when jobs execute.

## Environment

See `.env.example` for all variables.

## Run

```bash
pnpm --filter scheduler dev
```

## Build & Start

```bash
pnpm --filter scheduler build
pnpm --filter scheduler start
```
