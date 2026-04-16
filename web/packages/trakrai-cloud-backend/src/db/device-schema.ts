import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const device = pgTable('device', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique('device_device_id_unique'),
  name: text('name').notNull(),
  description: text('description'),
  accessToken: text('access_token').notNull().unique('device_access_token_unique'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

