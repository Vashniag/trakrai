import { desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { appAccessGrant, appDefinition } from '@/db/schema';
import { systemAppDefinitions } from '@/server/system-apps';
import { adminProcedure, createTRPCRouter } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});
const countExpression = sql<number>`cast(count(*) as int)`;

export const appsRouter = createTRPCRouter({
  createDefinition: adminProcedure
    .input(
      z.object({
        category: z.string().trim().min(2).default('operations'),
        description: z.string().trim().optional(),
        isSystem: z.boolean().default(false),
        key: z.string().trim().min(2),
        metadata: metadataSchema,
        name: z.string().trim().min(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(appDefinition)
        .values({
          category: input.category,
          description: input.description,
          isSystem: input.isSystem,
          key: input.key,
          metadata: input.metadata,
          name: input.name,
        })
        .returning();

      return created;
    }),

  listDefinitions: adminProcedure.query(async ({ ctx }) => {
    const [definitions, grantCounts] = await Promise.all([
      ctx.db.select().from(appDefinition).orderBy(desc(appDefinition.createdAt)),
      ctx.db
        .select({
          appId: appAccessGrant.appId,
          total: countExpression,
        })
        .from(appAccessGrant)
        .where(isNull(appAccessGrant.revokedAt))
        .groupBy(appAccessGrant.appId),
    ]);

    const grantsByApp = new Map(grantCounts.map((item) => [item.appId, item.total]));

    return {
      definitions: definitions.map((definition) => ({
        ...definition,
        activeGrantCount: grantsByApp.get(definition.id) ?? 0,
      })),
      suggestedCatalog: systemAppDefinitions,
    };
  }),
});
