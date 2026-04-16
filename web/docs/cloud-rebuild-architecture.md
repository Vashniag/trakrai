# Trakrai Cloud Rebuild Architecture

This document is the working architecture brief for rebuilding the Trakrai cloud app.

It is intentionally concrete. It should help future agents answer four questions quickly:

1. What are we rebuilding?
2. Which parts of the old systems do we keep?
3. Which contracts must stay generic and future-proof?
4. What is the implementation order that gets us to a working end-to-end system without painting us into a corner?

## 1. Product direction

The new cloud app is not a lift-and-shift of either legacy codebase.

- UI language and operator experience should borrow from `drivesafe`.
- App architecture, package boundaries, and runtime discipline should follow the new `trakrai/web` workspace.
- Workflow infrastructure should be rebuilt on the cleaner `fluxery` package model.
- Domain-specific cloud workflow nodes and device-workflow distribution patterns should be ported from `trakrboard-frontend`.
- ThingsBoard-shaped backend assumptions should be removed instead of adapted.

The result should be one cloud platform with:

- a first-class admin surface
- a domain model centered on enterprise hierarchy and device ownership
- explicit app access control
- generic external ingestion and file transfer contracts
- cloud and device workflows that evolve independently but share platform primitives

## 2. System boundaries

The rebuild should be treated as five bounded areas:

| Area | Responsibility | Must not do |
| --- | --- | --- |
| Identity | Sign-in, session management, credential lifecycle | Encode domain roles directly into auth tables |
| Authorization and admin | Org hierarchy, role bindings, app access, scoped administration | Own login/session implementation |
| Cloud application | Admin UI, device registry, domain APIs, workflow authoring, reporting | Interpret device transport packets in generic gateway layers |
| Device integration | Generic metadata delivery, signed URL fetch/upload, durable retries, video generation | Hardcode violation/tilt-specific behavior in transport services |
| Workflow platform | Graph authoring, runtime contracts, node/plugin model, trigger metadata | Depend on one-off page components or one product's table layout |

These boundaries matter more than individual frameworks. If a feature blurs them, it will be harder to extend later.

## 3. Domain model direction

### 3.1 Core hierarchy

The business hierarchy should remain explicit and readable:

- `headquarter`
- `factory`
- `department`
- `device`

Recommended ownership chain:

- one `headquarter` has many `factories`
- one `factory` has many `departments`
- one `department` has many `devices`

This is intentionally concrete instead of collapsing everything into a generic tree table. The product already thinks in these terms, and the admin UI will be much easier to reason about when the top-level entities are explicit.

### 3.2 Recommended relational model

Use explicit business tables plus reusable scope references for authorization.

Core domain tables:

- `headquarters`
- `factories`
- `departments`
- `devices`
- `apps`
- `app_resources`
- `device_tokens`
- `memberships`
- `role_definitions`
- `role_bindings`
- `permission_grants`
- `policy_rules`
- `audit_events`

Supporting workflow and integration tables:

- `cloud_workflows`
- `cloud_workflow_runs`
- `device_workflow_manifests`
- `device_workflow_schema_versions`
- `external_delivery_endpoints`
- `external_delivery_events`
- `file_transfer_jobs`
- `signed_url_requests`

### 3.3 Table intent

`headquarters`

- root business tenant
- contains branding, billing, regional defaults, retention defaults

`factories`

- physical or logical operating sites
- belong to a headquarter
- can override device defaults and local operating settings

`departments`

- sub-scope under a factory
- used for people ownership, app assignment, workflow targeting, and alert routing

`devices`

- registered edge runtimes
- belong to a department
- have stable public `deviceId`
- store lifecycle metadata such as `workflowSchemaHash`, software version, heartbeat status, and provisioning state

`device_tokens`

- one-to-many credential records per device
- store hashed tokens only
- support rotation, revocation, expiry, and provenance

`apps`

- catalog of cloud-visible apps or modules such as `live`, `violations`, `tilt`, `workflows`, `admin`, `reports`
- drives feature gating and navigation

`app_resources`

- optional finer-grained resource identifiers under an app
- examples: `violations.case`, `devices.command.ptz`, `workflow.cloud.edit`

`memberships`

- maps user to a business scope
- supports scope types such as `headquarter`, `factory`, `department`, `device`
- can be many-to-many

`role_definitions`

- named bundles of permissions
- includes system roles and custom organization-defined roles

`role_bindings`

- binds a user or group to a role at a given scope
- powers hierarchical admin delegation

`permission_grants`

- normalized allow or deny records
- lets us express action-level permission outside of auth

`policy_rules`

- optional ABAC predicates layered on top of role grants
- examples: time windows, department tags, device labels, app-specific conditions

### 3.4 Future-proof modeling rule

Use both:

- explicit business tables for the product hierarchy
- generic `scope_type` plus `scope_id` references anywhere authorization, audit, or policy evaluation needs polymorphism

That gives us readable business data and flexible access control without turning the whole schema into an opaque graph.

## 4. Auth and admin strategy

### 4.1 Better Auth stays the identity system

Better Auth should remain responsible for:

- email and password login
- social login where needed
- passkeys
- session management
- verification and reset flows

The Better Auth tables are identity infrastructure. They should not become the source of truth for organization structure, permissions, or admin delegation.

### 4.2 Domain authorization is custom

Authorization should be implemented in domain tables and evaluated in application code.

Recommended split:

- Better Auth answers: who is this user and is the session valid?
- Domain auth answers: what can this user do, in which scope, inside which app?

This lets us keep Better Auth upgrades safe while still supporting enterprise-grade scoped administration.

### 4.3 Required admin roles

System-level role:

- `sysadmin`: unrestricted across the platform

Scoped operator roles:

- `headquarter_admin`
- `factory_admin`
- `department_admin`

These roles are not enough by themselves. Each role should map to grant bundles and app access, not hardcoded branching in pages.

### 4.4 Recommended permission model

Use layered authorization:

1. RBAC for broad capability bundles
2. ACL-style bindings for app and resource grants
3. ABAC predicates for contextual restrictions

Examples:

- a `factory_admin` can manage departments only within factories they are bound to
- a department user can view `violations` but not `admin`
- a user can access the `live` app only for devices tagged to their department
- a reviewer can download evidence only within retention and export policy limits

### 4.5 Admin UX target

The admin surface should be designed around the `drivesafe` management patterns:

- dense table views
- right-side detail drawers
- inline scope assignment
- role explanation panels
- app access matrix views
- audit history near the object being administered

Minimum admin modules:

- user directory
- hierarchy management
- app catalog and access control
- device registration and device lifecycle
- role and permission management
- audit log

### 4.6 Authorization implementation rule

Never check access by role name alone inside feature code.

Feature code should ask domain authorization helpers questions like:

- `canViewApp(user, "violations", scope)`
- `canManageDevice(user, deviceId)`
- `canInvokeExternalRoute(user, "violations.create", scope)`

That keeps the rest of the codebase independent from how roles are assembled internally.

## 5. Device registration and management

Each device must have:

- a stable `deviceId`
- one or more rotatable `accessToken`s

Recommended registration states:

- `pending`
- `active`
- `disabled`
- `retired`

Device records should also track:

- deployment metadata
- last heartbeat
- last known software versions
- current schema hash
- assigned hierarchy scope
- enabled apps
- token rotation history

Recommended rule: the access token is a credential, not the device identity. Store the identity in `devices`, store token material separately in `device_tokens`.

## 6. Generic external event and file-transfer pattern

### 6.1 Design principle

Only the producer and final consumer should know business payload details.

Intermediate services must remain generic:

- gateway forwards
- cloud-comm transports metadata
- upload service manages signed URLs and retries
- video recorder generates requested artifacts

They must not special-case `violation`, `tilt`, or future event types.

### 6.2 Cloud metadata delivery pattern

MQTT is for metadata delivery, not for bulk file transport.

Recommended flow:

1. A workflow node or another service creates a domain payload.
2. It wraps the payload in a generic external dispatch envelope.
3. `cloud-comm` publishes the metadata envelope to the broker.
4. The cloud gateway receives the envelope and forwards it to the requested cloud endpoint under `/trpc/external/...`.
5. The cloud endpoint validates the payload and applies domain logic.

Recommended envelope shape:

```json
{
  "messageId": "01HZX....",
  "schemaVersion": 1,
  "timestamp": "2026-04-15T12:00:00Z",
  "source": {
    "deviceId": "device-001",
    "service": "workflow-engine"
  },
  "target": {
    "route": "violations.create"
  },
  "correlationId": "evt-123",
  "payload": {
    "eventType": "violation.detected",
    "data": {}
  },
  "attachments": [
    {
      "kind": "image",
      "objectKey": "violations/device-001/2026/04/15/evt-123.jpg"
    }
  ]
}
```

Important constraint: the gateway routes by declared target metadata, not by opening the business payload and branching on its contents.

### 6.3 File transfer pattern

Bulk upload and download should be HTTP-based with signed URLs.

Recommended service split on the device:

- `cloud-comm`
  - MQTT metadata transport only
  - no file upload logic
- `cloud-transfer`
  - signed URL acquisition
  - upload and download execution
  - durable retry queue
  - SQLite state
  - retry-until deadline handling
- `video-recorder`
  - rolling local 1 FPS archive for clip generation
  - generates MP4 clips from requested timeline windows
  - supports raw, bounding-box, and composite output modes

### 6.4 IPC contract direction

All device-local services should communicate through the common IPC layer using generic job envelopes.

Recommended job families:

- `external.dispatch`
- `file.upload.request`
- `file.download.request`
- `video.render.request`
- `job.completed`
- `job.failed`
- `job.progress`

Recommended rule: if a service did not create a job type and is not the final handler, it should not need to understand the nested domain payload.

### 6.5 Cloud endpoint structure

Expose external device-facing handlers under a dedicated namespace.

Recommended route shape:

- `/trpc/external/violations.create`
- `/trpc/external/tilt.create`
- future routes under the same namespace

The gateway should only resolve the route and pass the envelope through. Validation and storage decisions stay in the target cloud handler.

### 6.6 Persistence rules for transfer reliability

Durable transfer services should own a local SQLite queue with:

- job state
- retry policy
- first-attempt and last-attempt timestamps
- terminal deadline
- object path
- content type
- checksum
- post-transfer action

This makes uploads resilient to offline periods without making workflow nodes responsible for transport durability.

## 7. Workflow migration strategy

### 7.1 Canonical source split

Use `fluxery` for platform primitives and `trakrboard-frontend` for product-specific additions.

Port from `fluxery` first:

- core graph types and validation
- editor shell and provider model
- plugin model
- trigger handling
- cloud execution adapter patterns

Port from `trakrboard-frontend` selectively:

- domain-specific node schemas and node functions
- device workflow schema distribution path
- device workflow editor behavior
- violation and tilt workflow endpoints as initial cloud handlers

### 7.2 Cloud workflow target

Cloud workflow should support:

- authoring in the new cloud app
- object-storage-backed workflow JSON
- separate trigger metadata storage
- pluggable runtime integration
- business node packs for Trakrai features

Recommended rule: workflow graph JSON should not become a dumping ground for schedule state, sync tokens, or run artifacts.

### 7.3 Device workflow target

Device workflow remains schema-driven and versioned by hash.

The cloud side should own:

- workflow authoring UI
- schema parsing and validation
- manifest persistence
- secure status and download endpoints
- per-device schema hash tracking

The device side should own runtime execution.

### 7.4 Migration order

1. Re-establish shared workflow packages using the `fluxery` package boundaries.
2. Stand up one cloud workflow host inside `apps/trakrai`.
3. Port initial business nodes from `trakrboard-frontend`.
4. Rebuild device workflow distribution and schema-hash loading.
5. Add run history, debugging, and optional editor extras only after the core contracts are stable.

## 8. Practical phased implementation roadmap

### Phase 0: Foundation and guardrails

Goal:

- establish schema, naming, routing, and documentation conventions before broad implementation starts

Deliverables:

- domain schema design approved
- env contract for Postgres, auth, object storage, and external routes
- README links to rebuild docs
- test harness plan for auth, tRPC, and workflow flows

Exit criteria:

- migrations can be generated for both auth and domain tables
- one source-of-truth architecture doc exists

### Phase 1: Identity, admin shell, and hierarchy

Goal:

- ship a working admin-capable cloud app with real scoped data

Deliverables:

- Better Auth remains operational
- hierarchy tables and seed data
- user directory and scoped membership management
- sysadmin, headquarter, factory, and department admin permissions
- app access matrix

Exit criteria:

- an operator can create hierarchy entities and delegate scoped administration without SQL

### Phase 2: Device registry and cloud external surface

Goal:

- support real devices in the new domain model and receive metadata from them

Deliverables:

- device registration UI and API
- token issuance and rotation
- external route namespace
- initial violation and tilt handlers
- audit logging for registration, token rotation, and inbound external events

Exit criteria:

- one registered device can authenticate, publish metadata, and create domain records through the new cloud APIs

### Phase 3: Durable transfer and evidence pipeline

Goal:

- move image and video evidence transport onto generic services

Deliverables:

- signed URL request flow
- upload queue state model
- durable retries
- artifact status reporting
- cloud-side evidence linkage to domain records

Exit criteria:

- a device can upload image evidence reliably through retriable transfer jobs

### Phase 4: Video recorder integration

Goal:

- support timeline-based clip generation without coupling workflow logic to recorder internals

Deliverables:

- `video.render.request` contract
- raw and bounding-box clip generation
- composite clip option
- handoff to `cloud-transfer` when upload is requested

Exit criteria:

- a workflow can request a past or future window clip and receive terminal success or failure status through IPC

### Phase 5: Workflow migration

Goal:

- restore cloud and device workflow authoring on the new platform foundation

Deliverables:

- shared workflow package import from `fluxery`
- initial Trakrai domain nodes
- device workflow manifest and schema-hash path
- cloud workflow storage and execution path

Exit criteria:

- one cloud workflow and one device workflow can be authored, stored, validated, and executed through the new system

### Phase 6: Hardening and expansion

Goal:

- make the platform operable and safe for future teams

Deliverables:

- E2E coverage for auth, admin, device registration, external events, transfers, and workflows
- service and API observability
- audit views
- runbooks
- architecture decision log for future changes

Exit criteria:

- another team can onboard from docs, run tests, and extend one feature without reverse-engineering packet contracts

## 9. Testing strategy that should exist from the start

Minimum automated coverage:

- auth session and protected route tests
- domain authorization tests for scope inheritance and deny rules
- tRPC contract tests for admin and external routes
- database migration tests
- device registration and token rotation tests
- external route ingestion tests for `violations` and `tilt`
- transfer retry tests around durable queue semantics
- workflow save, validate, and run smoke tests

Preferred E2E shape:

- seed a local Postgres
- stand up the Next.js app
- exercise auth and admin through Playwright
- exercise external routes and signed URL flows through helper scripts
- keep stable fixtures for one device, one department, and one set of app grants

Current helper scripts:

- `pnpm --filter trakrai admin:bootstrap -- --email <email>`
- `pnpm --filter trakrai smoke:external`

The external smoke helper should stay green as the baseline check for the generic device-to-cloud evidence path. It covers:

- direct device credential authentication
- signed upload ticket issuance
- direct HTTP upload and download
- violation ingestion with an already-uploaded object key
- tilt ingestion without media

## 10. Non-negotiable rules

- Do not push domain authorization rules into Better Auth internals.
- Do not make gateways or transport services inspect business payload shapes.
- Do not put schedules, trigger state, or sync metadata directly into workflow graph JSON unless the runtime explicitly owns it.
- Do not make device tokens the primary identifier for devices.
- Do not rebuild the new app as a thin layer over ThingsBoard-era assumptions.
- Do not fork cloud and device workflow primitives when shared package boundaries can keep them aligned.

## 11. Immediate next implementation targets

If work starts tomorrow, the first useful build sequence is:

1. expand the Drizzle schema to include hierarchy, memberships, apps, roles, and devices
2. widen migration discovery so auth and domain schema migrate together
3. add domain authorization helpers and protected admin procedures
4. ship the first admin shell with hierarchy and user management
5. add device registration and token rotation
6. stand up `/trpc/external/violations.create` and `/trpc/external/tilt.create`
7. migrate the workflow platform in parallel behind package boundaries

That ordering gives us a working business foundation before we attach advanced evidence and workflow behavior.
