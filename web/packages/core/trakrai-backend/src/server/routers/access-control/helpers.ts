import { TRPCError } from '@trpc/server';

import type { Database } from '../../trpc';

import {
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  ensureUserCanManageObject,
  isSysAdminRole,
} from '../../../lib/authz';

export const requireSysAdmin = (role: string | null | undefined) => {
  if (!isSysAdminRole(role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only sysadmins can perform this action.',
    });
  }
};

export type ProtectedContext = {
  db: Database;
  user: {
    id: string;
    role?: string | null;
  };
};

export const assertUserCanManageScope = async (
  ctx: ProtectedContext,
  input:
    | { scopeType: 'component'; scopeId: string }
    | { scopeType: 'department'; scopeId: string }
    | { scopeType: 'device'; scopeId: string }
    | { scopeType: 'factory'; scopeId: string },
) => {
  if (isSysAdminRole(ctx.user.role)) {
    return;
  }

  switch (input.scopeType) {
    case 'factory':
      await ensureUserCanManageObject(ctx.user.id, AUTHZ_TYPE_FACTORY, input.scopeId);
      return;
    case 'department':
      await ensureUserCanManageObject(ctx.user.id, AUTHZ_TYPE_DEPARTMENT, input.scopeId);
      return;
    case 'device':
      await ensureUserCanManageObject(ctx.user.id, AUTHZ_TYPE_DEVICE, input.scopeId);
      return;
    case 'component':
      await ensureUserCanManageObject(ctx.user.id, AUTHZ_TYPE_DEVICE_COMPONENT, input.scopeId);
      return;
  }
};
