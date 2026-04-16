import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { department, device, factory, headquarter } from '@/db/schema';
import { adminProcedure, createTRPCRouter } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});

export const hierarchyRouter = createTRPCRouter({
  snapshot: adminProcedure.query(async ({ ctx }) => {
    const [headquarters, factories, departments, devices] = await Promise.all([
      ctx.db.select().from(headquarter).orderBy(desc(headquarter.createdAt)),
      ctx.db.select().from(factory).orderBy(desc(factory.createdAt)),
      ctx.db.select().from(department).orderBy(desc(department.createdAt)),
      ctx.db.select().from(device).orderBy(desc(device.createdAt)),
    ]);

    return {
      headquarters,
      factories,
      departments,
      devices,
    };
  }),

  createHeadquarter: adminProcedure
    .input(
      z.object({
        slug: z.string().trim().min(2),
        name: z.string().trim().min(2),
        code: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(2).default('Asia/Kolkata'),
        metadata: metadataSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(headquarter)
        .values(input)
        .returning();

      return created;
    }),

  createFactory: adminProcedure
    .input(
      z.object({
        headquarterId: z.string().uuid(),
        slug: z.string().trim().min(2),
        name: z.string().trim().min(2),
        code: z.string().trim().min(1).optional(),
        timezone: z.string().trim().min(2).optional(),
        metadata: metadataSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(factory)
        .values(input)
        .returning();

      return created;
    }),

  createDepartment: adminProcedure
    .input(
      z.object({
        factoryId: z.string().uuid(),
        slug: z.string().trim().min(2),
        name: z.string().trim().min(2),
        code: z.string().trim().min(1).optional(),
        metadata: metadataSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(department)
        .values(input)
        .returning();

      return created;
    }),

  listFactories: adminProcedure
    .input(z.object({ headquarterId: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      ctx.db
        .select()
        .from(factory)
        .where(eq(factory.headquarterId, input.headquarterId))
        .orderBy(factory.name),
    ),

  listDepartments: adminProcedure
    .input(z.object({ factoryId: z.string().uuid() }))
    .query(async ({ ctx, input }) =>
      ctx.db
        .select()
        .from(department)
        .where(eq(department.factoryId, input.factoryId))
        .orderBy(department.name),
    ),
});
