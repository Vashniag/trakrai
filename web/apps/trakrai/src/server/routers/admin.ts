import { desc, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  appAccessGrant,
  appDefinition,
  department,
  device,
  externalMessage,
  headquarter,
  storageObject,
  tiltEvent,
  user,
  userScopeMembership,
  violationEvent,
  factory,
} from '@/db/schema';
import { buildBootstrapPayload, resolveAccessContext } from '@/server/access-helpers';
import { systemAppDefinitions } from '@/server/system-apps';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/trpc';

const countExpression = sql<number>`cast(count(*) as int)`;

export const adminRouter = createTRPCRouter({
  bootstrapStatus: protectedProcedure.query(async ({ ctx }) => {
    const access = await resolveAccessContext(ctx.db, ctx.user);
    const bootstrap = buildBootstrapPayload(access);

    return {
      ...bootstrap,
      isAdmin: access.canAccessAdminConsole,
      isSystemAdmin: access.isSystemAdmin,
    };
  }),

  overview: adminProcedure.query(async ({ ctx }) => {
    const [
      userCountResult,
      headquarterCountResult,
      factoryCountResult,
      departmentCountResult,
      deviceCountResult,
      membershipCountResult,
      appCountResult,
    ] = await Promise.all([
      ctx.db.select({ userCount: countExpression }).from(user),
      ctx.db.select({ headquarterCount: countExpression }).from(headquarter),
      ctx.db.select({ factoryCount: countExpression }).from(factory),
      ctx.db.select({ departmentCount: countExpression }).from(department),
      ctx.db.select({ deviceCount: countExpression }).from(device),
      ctx.db.select({ membershipCount: countExpression }).from(userScopeMembership),
      ctx.db.select({ appCount: countExpression }).from(appDefinition),
    ]);
    const userCount = userCountResult[0]?.userCount ?? 0;
    const headquarterCount = headquarterCountResult[0]?.headquarterCount ?? 0;
    const factoryCount = factoryCountResult[0]?.factoryCount ?? 0;
    const departmentCount = departmentCountResult[0]?.departmentCount ?? 0;
    const deviceCount = deviceCountResult[0]?.deviceCount ?? 0;
    const membershipCount = membershipCountResult[0]?.membershipCount ?? 0;
    const appCount = appCountResult[0]?.appCount ?? 0;

    const recentUsers = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(5);

    const grantCount = await ctx.db
      .select({ appGrantCount: countExpression })
      .from(appAccessGrant);

    return {
      counts: {
        users: userCount,
        headquarters: headquarterCount,
        factories: factoryCount,
        departments: departmentCount,
        devices: deviceCount,
        memberships: membershipCount,
        appDefinitions: appCount,
        appGrants: grantCount[0]?.appGrantCount ?? 0,
      },
      recentUsers,
    };
  }),

  listUsers: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          search: z.string().trim().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 50;
      const search = input?.search;

      const users = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          banned: user.banned,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(
          search
            ? or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
            : undefined,
        )
        .orderBy(desc(user.createdAt))
        .limit(limit);

      return {
        users,
      };
    }),

  listApps: adminProcedure.query(async ({ ctx }) => {
    const apps = await ctx.db
      .select({
        id: appDefinition.id,
        key: appDefinition.key,
        name: appDefinition.name,
        description: appDefinition.description,
        category: appDefinition.category,
        isSystem: appDefinition.isSystem,
        metadata: appDefinition.metadata,
        createdAt: appDefinition.createdAt,
        updatedAt: appDefinition.updatedAt,
      })
      .from(appDefinition)
      .orderBy(appDefinition.category, appDefinition.name);

    return {
      apps,
      systemBlueprint: systemAppDefinitions,
    };
  }),

  seedSystemApps: adminProcedure.mutation(async ({ ctx }) => {
    const seeded = await Promise.all(
      systemAppDefinitions.map(async (definition) => {
        const upserted = (
          await ctx.db
            .insert(appDefinition)
            .values(definition)
            .onConflictDoUpdate({
              target: appDefinition.key,
              set: {
                name: definition.name,
                description: definition.description,
                category: definition.category,
                isSystem: definition.isSystem,
                metadata: definition.metadata,
                updatedAt: new Date(),
              },
            })
            .returning({
              id: appDefinition.id,
              key: appDefinition.key,
              name: appDefinition.name,
              category: appDefinition.category,
              updatedAt: appDefinition.updatedAt,
            })
        )[0];

        return upserted;
      }),
    );

    return {
      count: seeded.length,
      apps: seeded.filter((app): app is NonNullable<typeof app> => app !== undefined),
    };
  }),

  eventOverview: adminProcedure.query(async ({ ctx }) => {
    const [
      messageCountResult,
      violationCountResult,
      tiltCountResult,
      storageCountResult,
      recentViolationEvents,
      recentTiltEvents,
    ] = await Promise.all([
      ctx.db.select({ messageCount: countExpression }).from(externalMessage),
      ctx.db.select({ violationCount: countExpression }).from(violationEvent),
      ctx.db.select({ tiltCount: countExpression }).from(tiltEvent),
      ctx.db.select({ storageCount: countExpression }).from(storageObject),
      ctx.db
        .select({
          id: violationEvent.id,
          type: sql<string>`'violation'`,
          title: violationEvent.title,
          summary: violationEvent.summary,
          severity: violationEvent.severity,
          devicePublicId: violationEvent.devicePublicId,
          occurredAt: violationEvent.occurredAt,
        })
        .from(violationEvent)
        .orderBy(desc(violationEvent.occurredAt))
        .limit(5),
      ctx.db
        .select({
          id: tiltEvent.id,
          type: sql<string>`'tilt'`,
          title: tiltEvent.title,
          summary: tiltEvent.summary,
          severity: tiltEvent.severity,
          devicePublicId: tiltEvent.devicePublicId,
          occurredAt: tiltEvent.occurredAt,
        })
        .from(tiltEvent)
        .orderBy(desc(tiltEvent.occurredAt))
        .limit(5),
    ]);

    const recentEvents = [...recentViolationEvents, ...recentTiltEvents]
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, 8);

    return {
      counts: {
        externalMessages: messageCountResult[0]?.messageCount ?? 0,
        violations: violationCountResult[0]?.violationCount ?? 0,
        tilts: tiltCountResult[0]?.tiltCount ?? 0,
        storageObjects: storageCountResult[0]?.storageCount ?? 0,
      },
      recentEvents,
    };
  }),
});
