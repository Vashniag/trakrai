import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  appAccessGrant,
  appDefinition,
  tiltEvent,
  user,
  userScopeMembership,
  violationEvent,
} from '@/db/schema';
import { scopeKindValues } from '@/lib/access-control';
import {
  assertCanAccessDevice,
  assertCanManageScope,
  buildAccessibleHierarchyTree,
  buildBootstrapPayload,
  canManageScope,
  describeScope,
  describeScopePath,
  findDeviceByPublicId,
  getDeviceWorkspacePayload,
  listManageableScopes,
  listVisibleUsers,
  resolveAccessContext,
  type ScopeRef,
} from '@/server/access-helpers';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';

const metadataSchema = z.record(z.string(), z.unknown()).default({});
const conditionsSchema = z.record(z.string(), z.unknown()).default({});
const scopeKindSchema = z.enum(scopeKindValues);

const optionalSearchSchema = z
  .object({
    search: z.string().trim().min(1).optional(),
  })
  .optional();

const buildScopePayload = (
  access: Awaited<ReturnType<typeof resolveAccessContext>>,
  scope: ScopeRef,
) => {
  const descriptor = describeScope(access.hierarchy, scope.kind, scope.id);

  return {
    canManageApps: canManageScope(access, scope, 'app'),
    canManageDevices: canManageScope(access, scope, 'device'),
    canManageHierarchy: canManageScope(access, scope, 'hierarchy'),
    canManageMemberships: canManageScope(access, scope, 'membership'),
    descriptor,
    path: descriptor ? describeScopePath(access.hierarchy, descriptor) : [],
  };
};

export const accessRouter = createTRPCRouter({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    const access = await resolveAccessContext(ctx.db, ctx.user);

    return buildBootstrapPayload(access);
  }),

  deviceTree: protectedProcedure.query(async ({ ctx }) => {
    const access = await resolveAccessContext(ctx.db, ctx.user);

    return {
      manageableScopes: listManageableScopes(access),
      ...buildAccessibleHierarchyTree(access),
    };
  }),

  deviceWorkspace: protectedProcedure
    .input(
      z
        .object({
          deviceId: z.string().trim().min(1).optional(),
          devicePublicId: z.string().trim().min(1).optional(),
        })
        .refine((value) => value.deviceId || value.devicePublicId, {
          message: 'deviceId or devicePublicId is required',
          path: ['deviceId'],
        }),
    )
    .query(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const deviceRecord = input.deviceId
        ? assertCanAccessDevice(access, input.deviceId)
        : (() => {
            const matched = findDeviceByPublicId(access.hierarchy, input.devicePublicId!);
            if (!matched) {
              throw new TRPCError({ code: 'NOT_FOUND' });
            }

            return assertCanAccessDevice(access, matched.id);
          })();

      const [recentViolations, recentTilts] = await Promise.all([
        ctx.db
          .select({
            id: violationEvent.id,
            occurredAt: violationEvent.occurredAt,
            severity: violationEvent.severity,
            summary: violationEvent.summary,
            title: violationEvent.title,
          })
          .from(violationEvent)
          .where(eq(violationEvent.deviceId, deviceRecord.id))
          .orderBy(desc(violationEvent.occurredAt))
          .limit(12),
        ctx.db
          .select({
            angle: tiltEvent.angle,
            id: tiltEvent.id,
            occurredAt: tiltEvent.occurredAt,
            severity: tiltEvent.severity,
            summary: tiltEvent.summary,
            title: tiltEvent.title,
          })
          .from(tiltEvent)
          .where(eq(tiltEvent.deviceId, deviceRecord.id))
          .orderBy(desc(tiltEvent.occurredAt))
          .limit(12),
      ]);

      return {
        ...getDeviceWorkspacePayload(access, deviceRecord),
        recentTilts,
        recentViolations,
      };
    }),

  manageableScopes: protectedProcedure.query(async ({ ctx }) => {
    const access = await resolveAccessContext(ctx.db, ctx.user);

    return {
      scopes: listManageableScopes(access),
    };
  }),

  directory: protectedProcedure.input(optionalSearchSchema).query(async ({ ctx, input }) => {
    const access = await resolveAccessContext(ctx.db, ctx.user);
    const [visibleUsers, allMemberships, allAppGrants] = await Promise.all([
      listVisibleUsers(ctx.db, access, input?.search),
      ctx.db
        .select()
        .from(userScopeMembership)
        .where(isNull(userScopeMembership.revokedAt)),
      ctx.db
        .select()
        .from(appAccessGrant)
        .where(isNull(appAccessGrant.revokedAt)),
    ]);

    const visibleUserIds = new Set(visibleUsers.map((entry) => entry.id));
    const membershipsByUserId = new Map<string, typeof allMemberships>();
    const appGrantsByUserId = new Map<string, typeof allAppGrants>();

    allMemberships
      .filter(
        (membership) =>
          visibleUserIds.has(membership.userId) &&
          (access.isSystemAdmin ||
            membership.userId === access.user.id ||
            canManageScope(
              access,
              { kind: membership.scopeKind, id: membership.scopeId },
              'membership',
            )),
      )
      .forEach((membership) => {
        const collection = membershipsByUserId.get(membership.userId) ?? [];
        collection.push(membership);
        membershipsByUserId.set(membership.userId, collection);
      });

    allAppGrants
      .filter(
        (grant) =>
          grant.subjectType === 'user' &&
          visibleUserIds.has(grant.subjectId) &&
          (access.isSystemAdmin ||
            canManageScope(access, { kind: grant.scopeKind, id: grant.scopeId }, 'app')),
      )
      .forEach((grant) => {
        const collection = appGrantsByUserId.get(grant.subjectId) ?? [];
        collection.push(grant);
        appGrantsByUserId.set(grant.subjectId, collection);
      });

    return {
      users: visibleUsers
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((visibleUser) => ({
          ...visibleUser,
          activeAppGrantCount: appGrantsByUserId.get(visibleUser.id)?.length ?? 0,
          memberships:
            membershipsByUserId.get(visibleUser.id)?.map((membership) => ({
              id: membership.id,
              metadata: membership.metadata,
              roleKey: membership.roleKey,
              scope: buildScopePayload(access, {
                id: membership.scopeId,
                kind: membership.scopeKind,
              }),
            })) ?? [],
        })),
    };
  }),

  listMemberships: protectedProcedure
    .input(
      z
        .object({
          scopeId: z.string().trim().min(1).optional(),
          scopeKind: scopeKindSchema.optional(),
          userId: z.string().trim().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const memberships = await ctx.db
        .select()
        .from(userScopeMembership)
        .where(isNull(userScopeMembership.revokedAt))
        .orderBy(desc(userScopeMembership.createdAt));

      const filtered = memberships.filter((membership) => {
        if (input?.userId && membership.userId !== input.userId) {
          return false;
        }

        if (
          input?.scopeId &&
          input.scopeKind &&
          (membership.scopeId !== input.scopeId || membership.scopeKind !== input.scopeKind)
        ) {
          return false;
        }

        return (
          access.isSystemAdmin ||
          membership.userId === access.user.id ||
          canManageScope(
            access,
            { kind: membership.scopeKind, id: membership.scopeId },
            'membership',
          )
        );
      });

      const userIds = Array.from(new Set(filtered.map((membership) => membership.userId)));
      const users =
        userIds.length === 0
          ? []
          : await ctx.db.select().from(user).where(inArray(user.id, userIds));
      const usersById = new Map(users.map((row) => [row.id, row]));

      return {
        memberships: filtered.map((membership) => ({
          ...membership,
          permissions: buildScopePayload(access, {
            id: membership.scopeId,
            kind: membership.scopeKind,
          }),
          scope: describeScope(access.hierarchy, membership.scopeKind, membership.scopeId),
          scopePath: describeScopePath(access.hierarchy, {
            id: membership.scopeId,
            kind: membership.scopeKind,
          }),
          user: usersById.get(membership.userId) ?? null,
        })),
      };
    }),

  upsertMembership: protectedProcedure
    .input(
      z.object({
        metadata: metadataSchema,
        roleKey: z.string().trim().min(1),
        scopeId: z.string().trim().min(1),
        scopeKind: scopeKindSchema,
        userId: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const scope = { id: input.scopeId, kind: input.scopeKind } as const;
      assertCanManageScope(access, scope, 'membership');

      const [targetUser] = await ctx.db.select().from(user).where(eq(user.id, input.userId)).limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const [existing] = await ctx.db
        .select()
        .from(userScopeMembership)
        .where(
          and(
            eq(userScopeMembership.userId, input.userId),
            eq(userScopeMembership.scopeKind, input.scopeKind),
            eq(userScopeMembership.scopeId, input.scopeId),
            eq(userScopeMembership.roleKey, input.roleKey),
            isNull(userScopeMembership.revokedAt),
          ),
        )
        .limit(1);

      const membership = existing
        ? (
            await ctx.db
              .update(userScopeMembership)
              .set({
                grantedByUserId: ctx.user.id,
                metadata: input.metadata,
                updatedAt: new Date(),
              })
              .where(eq(userScopeMembership.id, existing.id))
              .returning()
          )[0]
        : (
            await ctx.db
              .insert(userScopeMembership)
              .values({
                grantedByUserId: ctx.user.id,
                metadata: input.metadata,
                roleKey: input.roleKey,
                scopeId: input.scopeId,
                scopeKind: input.scopeKind,
                userId: input.userId,
              })
              .returning()
          )[0];

      return {
        membership,
        scope: buildScopePayload(access, scope),
        scopePath: describeScopePath(access.hierarchy, scope),
        user: {
          email: targetUser.email,
          id: targetUser.id,
          name: targetUser.name,
          role: targetUser.role,
        },
      };
    }),

  revokeMembership: protectedProcedure
    .input(z.object({ membershipId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const [existing] = await ctx.db
        .select()
        .from(userScopeMembership)
        .where(eq(userScopeMembership.id, input.membershipId))
        .limit(1);

      if (!existing || existing.revokedAt) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      assertCanManageScope(
        access,
        { id: existing.scopeId, kind: existing.scopeKind },
        'membership',
      );

      const [revoked] = await ctx.db
        .update(userScopeMembership)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userScopeMembership.id, existing.id))
        .returning();

      return {
        membership: revoked,
      };
    }),

  listAppGrants: protectedProcedure
    .input(
      z
        .object({
          appId: z.string().trim().min(1).optional(),
          scopeId: z.string().trim().min(1).optional(),
          scopeKind: scopeKindSchema.optional(),
          subjectId: z.string().trim().min(1).optional(),
          subjectType: z.string().trim().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const [grants, apps, users] = await Promise.all([
        ctx.db
          .select()
          .from(appAccessGrant)
          .where(isNull(appAccessGrant.revokedAt))
          .orderBy(desc(appAccessGrant.createdAt)),
        ctx.db.select().from(appDefinition),
        ctx.db.select().from(user),
      ]);

      const appsById = new Map(apps.map((row) => [row.id, row]));
      const usersById = new Map(users.map((row) => [row.id, row]));

      return {
        grants: grants
          .filter((grant) => {
            if (input?.appId && grant.appId !== input.appId) {
              return false;
            }

            if (input?.subjectId && grant.subjectId !== input.subjectId) {
              return false;
            }

            if (input?.subjectType && grant.subjectType !== input.subjectType) {
              return false;
            }

            if (
              input?.scopeId &&
              input.scopeKind &&
              (grant.scopeId !== input.scopeId || grant.scopeKind !== input.scopeKind)
            ) {
              return false;
            }

            return (
              access.isSystemAdmin ||
              canManageScope(access, { id: grant.scopeId, kind: grant.scopeKind }, 'app')
            );
          })
          .map((grant) => ({
            ...grant,
            app: appsById.get(grant.appId) ?? null,
            scope: buildScopePayload(access, { id: grant.scopeId, kind: grant.scopeKind }),
            subjectUser: grant.subjectType === 'user' ? usersById.get(grant.subjectId) ?? null : null,
          })),
      };
    }),

  upsertAppGrant: protectedProcedure
    .input(
      z.object({
        accessLevel: z.enum(['view', 'operate', 'manage']).default('view'),
        appId: z.string().trim().min(1),
        conditions: conditionsSchema,
        effect: z.enum(['allow', 'deny']).default('allow'),
        scopeId: z.string().trim().min(1),
        scopeKind: scopeKindSchema,
        subjectId: z.string().trim().min(1),
        subjectType: z.string().trim().min(1).default('user'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const scope = { id: input.scopeId, kind: input.scopeKind } as const;
      assertCanManageScope(access, scope, 'app');

      const [app] = await ctx.db.select().from(appDefinition).where(eq(appDefinition.id, input.appId)).limit(1);
      if (!app) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'App definition not found' });
      }

      if (input.subjectType === 'user') {
        const [subjectUser] = await ctx.db
          .select()
          .from(user)
          .where(eq(user.id, input.subjectId))
          .limit(1);
        if (!subjectUser) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Subject user not found' });
        }
      }

      const [existing] = await ctx.db
        .select()
        .from(appAccessGrant)
        .where(
          and(
            eq(appAccessGrant.subjectType, input.subjectType),
            eq(appAccessGrant.subjectId, input.subjectId),
            eq(appAccessGrant.appId, input.appId),
            eq(appAccessGrant.scopeKind, input.scopeKind),
            eq(appAccessGrant.scopeId, input.scopeId),
            isNull(appAccessGrant.revokedAt),
          ),
        )
        .limit(1);

      const grant = existing
        ? (
            await ctx.db
              .update(appAccessGrant)
              .set({
                accessLevel: input.accessLevel,
                conditions: input.conditions,
                effect: input.effect,
                grantedByUserId: ctx.user.id,
                updatedAt: new Date(),
              })
              .where(eq(appAccessGrant.id, existing.id))
              .returning()
          )[0]
        : (
            await ctx.db
              .insert(appAccessGrant)
              .values({
                accessLevel: input.accessLevel,
                appId: input.appId,
                conditions: input.conditions,
                effect: input.effect,
                grantedByUserId: ctx.user.id,
                scopeId: input.scopeId,
                scopeKind: input.scopeKind,
                subjectId: input.subjectId,
                subjectType: input.subjectType,
              })
              .returning()
          )[0];

      return {
        app,
        grant,
        scope: buildScopePayload(access, scope),
      };
    }),

  revokeAppGrant: protectedProcedure
    .input(z.object({ grantId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccessContext(ctx.db, ctx.user);
      const [existing] = await ctx.db
        .select()
        .from(appAccessGrant)
        .where(eq(appAccessGrant.id, input.grantId))
        .limit(1);

      if (!existing || existing.revokedAt) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      assertCanManageScope(
        access,
        { id: existing.scopeId, kind: existing.scopeKind },
        'app',
      );

      const [revoked] = await ctx.db
        .update(appAccessGrant)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(appAccessGrant.id, existing.id))
        .returning();

      return {
        grant: revoked,
      };
    }),
});
