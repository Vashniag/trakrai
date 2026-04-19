import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const factory = pgTable('factory', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const department = pgTable('department', {
  id: text('id').primaryKey(),
  factoryId: text('factory_id')
    .notNull()
    .references(() => factory.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const device = pgTable('device', {
  id: text('id').primaryKey(),
  departmentId: text('department_id')
    .notNull()
    .references(() => department.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  description: text('description'),
  accessToken: text('access_token').notNull().unique('device_access_token_unique'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const deviceComponentCatalog = pgTable('device_component_catalog', {
  key: text('key').primaryKey(),
  serviceName: text('service_name').notNull(),
  displayName: text('display_name').notNull(),
  navigationLabel: text('navigation_label').notNull(),
  routePath: text('route_path'),
  rendererKey: text('renderer_key'),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  defaultEnabled: boolean('default_enabled').default(true).notNull(),
  readActions: text('read_actions')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  writeActions: text('write_actions')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const deviceComponentInstallation = pgTable(
  'device_component_installation',
  {
    id: text('id').primaryKey(),
    deviceId: text('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    componentKey: text('component_key')
      .notNull()
      .references(() => deviceComponentCatalog.key, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => ({
    uniqueDeviceComponent: uniqueIndex('device_component_installation_device_component_unique').on(
      table.deviceId,
      table.componentKey,
    ),
  }),
);
