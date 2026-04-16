import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

const now = () => new Date();

const timestampColumns = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(now)
    .notNull(),
};

export const scopeKindEnum = pgEnum('scope_kind', [
  'platform',
  'headquarter',
  'factory',
  'department',
  'device',
]);

export const deviceStatusEnum = pgEnum('device_status', [
  'pending',
  'active',
  'inactive',
  'disabled',
]);

export const accessEffectEnum = pgEnum('access_effect', ['allow', 'deny']);

export const accessLevelEnum = pgEnum('access_level', ['view', 'operate', 'manage']);

export const externalMessageStatusEnum = pgEnum('external_message_status', [
  'accepted',
  'processed',
  'failed',
]);

export const eventSeverityEnum = pgEnum('event_severity', [
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

export const storageObjectStatusEnum = pgEnum('storage_object_status', [
  'requested',
  'uploaded',
  'failed',
  'expired',
]);

export const appDefinition = pgTable(
  'app_definition',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull().default('operations'),
    isSystem: boolean('is_system').notNull().default(false),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestampColumns,
  },
  (table) => [uniqueIndex('app_definition_key_unique').on(table.key)],
);

export const headquarter = pgTable(
  'headquarter',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('headquarter_slug_unique').on(table.slug),
    uniqueIndex('headquarter_code_unique').on(table.code),
  ],
);

export const factory = pgTable(
  'factory',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    headquarterId: text('headquarter_id')
      .notNull()
      .references(() => headquarter.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    timezone: text('timezone'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestampColumns,
  },
  (table) => [
    index('factory_headquarter_idx').on(table.headquarterId),
    uniqueIndex('factory_headquarter_slug_unique').on(table.headquarterId, table.slug),
  ],
);

export const department = pgTable(
  'department',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    factoryId: text('factory_id')
      .notNull()
      .references(() => factory.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestampColumns,
  },
  (table) => [
    index('department_factory_idx').on(table.factoryId),
    uniqueIndex('department_factory_slug_unique').on(table.factoryId, table.slug),
  ],
);

export const device = pgTable(
  'device',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    publicId: text('public_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    departmentId: text('department_id').references(() => department.id, {
      onDelete: 'set null',
    }),
    status: deviceStatusEnum('status').notNull().default('pending'),
    lastSeenAt: timestamp('last_seen_at'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('device_public_id_unique').on(table.publicId),
    index('device_department_idx').on(table.departmentId),
  ],
);

export const deviceToken = pgTable(
  'device_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('Primary token'),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    ...timestampColumns,
  },
  (table) => [
    index('device_token_device_idx').on(table.deviceId),
    uniqueIndex('device_token_hash_unique').on(table.tokenHash),
  ],
);

export const userScopeMembership = pgTable(
  'user_scope_membership',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopeKind: scopeKindEnum('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    roleKey: text('role_key').notNull(),
    grantedByUserId: text('granted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    revokedAt: timestamp('revoked_at'),
    ...timestampColumns,
  },
  (table) => [
    index('user_scope_membership_user_idx').on(table.userId),
    index('user_scope_membership_scope_idx').on(table.scopeKind, table.scopeId),
  ],
);

export const appAccessGrant = pgTable(
  'app_access_grant',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    subjectType: text('subject_type').notNull().default('user'),
    subjectId: text('subject_id').notNull(),
    appId: text('app_id')
      .notNull()
      .references(() => appDefinition.id, { onDelete: 'cascade' }),
    scopeKind: scopeKindEnum('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    accessLevel: accessLevelEnum('access_level').notNull().default('view'),
    effect: accessEffectEnum('effect').notNull().default('allow'),
    conditions: jsonb('conditions')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    grantedByUserId: text('granted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at'),
    ...timestampColumns,
  },
  (table) => [
    index('app_access_grant_subject_idx').on(table.subjectType, table.subjectId),
    index('app_access_grant_scope_idx').on(table.scopeKind, table.scopeId),
  ],
);

export const storageObject = pgTable(
  'storage_object',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type'),
    purpose: text('purpose').notNull(),
    status: storageObjectStatusEnum('status').notNull().default('requested'),
    sizeBytes: text('size_bytes'),
    checksum: text('checksum'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    uploadedAt: timestamp('uploaded_at'),
    expiresAt: timestamp('expires_at'),
    createdByDeviceId: text('created_by_device_id').references(() => device.id, {
      onDelete: 'set null',
    }),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ...timestampColumns,
  },
  (table) => [uniqueIndex('storage_object_key_unique').on(table.objectKey)],
);

export const externalMessage = pgTable(
  'external_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    requestPath: text('request_path').notNull(),
    messageType: text('message_type').notNull(),
    schemaVersion: text('schema_version').notNull().default('1.0'),
    sourceType: text('source_type').notNull().default('device'),
    sourceId: text('source_id'),
    correlationId: text('correlation_id'),
    target: text('target').notNull(),
    status: externalMessageStatusEnum('status').notNull().default('accepted'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    attachments: jsonb('attachments')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    processedAt: timestamp('processed_at'),
    errorMessage: text('error_message'),
    ...timestampColumns,
  },
  (table) => [
    index('external_message_target_idx').on(table.target),
    index('external_message_source_idx').on(table.sourceType, table.sourceId),
  ],
);

export const violationEvent = pgTable(
  'violation_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    externalMessageId: text('external_message_id').references(() => externalMessage.id, {
      onDelete: 'set null',
    }),
    deviceId: text('device_id').references(() => device.id, { onDelete: 'set null' }),
    devicePublicId: text('device_public_id'),
    title: text('title').notNull(),
    severity: eventSeverityEnum('severity').notNull().default('medium'),
    summary: text('summary'),
    imageObjectId: text('image_object_id').references(() => storageObject.id, {
      onDelete: 'set null',
    }),
    videoObjectId: text('video_object_id').references(() => storageObject.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    rawPayload: jsonb('raw_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
    ...timestampColumns,
  },
  (table) => [index('violation_event_device_idx').on(table.deviceId)],
);

export const tiltEvent = pgTable(
  'tilt_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    externalMessageId: text('external_message_id').references(() => externalMessage.id, {
      onDelete: 'set null',
    }),
    deviceId: text('device_id').references(() => device.id, { onDelete: 'set null' }),
    devicePublicId: text('device_public_id'),
    title: text('title').notNull(),
    severity: eventSeverityEnum('severity').notNull().default('medium'),
    summary: text('summary'),
    angle: text('angle'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    rawPayload: jsonb('raw_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
    ...timestampColumns,
  },
  (table) => [index('tilt_event_device_idx').on(table.deviceId)],
);
