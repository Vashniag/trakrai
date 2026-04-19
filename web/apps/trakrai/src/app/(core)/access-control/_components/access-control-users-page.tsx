'use client';

import { useCallback, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { useMutation } from '@tanstack/react-query';
import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { MutationModal } from '@trakrai/design-system/components/mutation-modal';
import { toast } from 'sonner';

import {
  BAN_DAY_SECONDS,
  DEFAULT_PASSWORD,
  banUserSchema,
  createUserSchema,
  describeBanState,
  formatDateTime,
  resetPasswordSchema,
  setUserRoleSchema,
} from '@/app/(core)/access-control/_components/access-control-page-lib';
import { AccessControlShell } from '@/app/(core)/access-control/_components/access-control-shell';
import { ServerDataTable } from '@/components/hierarchy/server-data-table';
import { StatCard } from '@/components/hierarchy/stat-card';
import { betterAuthAdminApi } from '@/lib/better-auth-admin';

import type { ColumnDef } from '@tanstack/react-table';
import type { RouterOutput } from '@trakrai/backend/server/routers';

type UsersPageData = RouterOutput['accessControl']['listUsers'];
type UserRow = UsersPageData['table']['rows'][number];

export const AccessControlUsersPage = ({ data }: Readonly<{ data: UsersPageData }>) => {
  const router = useRouter();

  const createUserMutation = useMutation({
    mutationFn: async (values: {
      email: string;
      emailVerified: boolean;
      name: string;
      password: string;
      role: 'admin' | 'user';
    }) =>
      betterAuthAdminApi.createUser({
        data: {
          emailVerified: values.emailVerified,
        },
        email: values.email,
        name: values.name,
        password: values.password,
        role: values.role,
      }),
  });
  const setUserRoleMutation = useMutation({
    mutationFn: (values: { role: 'admin' | 'user'; userId: string }) =>
      betterAuthAdminApi.setRole(values),
  });
  const resetPasswordMutation = useMutation({
    mutationFn: (values: { newPassword: string; userId: string }) =>
      betterAuthAdminApi.setUserPassword(values),
  });
  const banUserMutation = useMutation({
    mutationFn: (values: { banExpiresIn: number; banReason: string; userId: string }) =>
      betterAuthAdminApi.banUser(values),
  });
  const unbanUserMutation = useMutation({
    mutationFn: (values: { userId: string }) => betterAuthAdminApi.unbanUser(values),
  });
  const removeUserMutation = useMutation({
    mutationFn: (values: { userId: string }) => betterAuthAdminApi.removeUser(values),
  });

  const refresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  const handleUnban = useCallback(
    async (userId: string) => {
      try {
        await unbanUserMutation.mutateAsync({ userId });
        toast.success('User unbanned.');
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to unban user.');
      }
    },
    [refresh, unbanUserMutation],
  );

  const handleDelete = useCallback(
    async (email: string, userId: string) => {
      if (window.confirm(`Delete ${email}?`) === false) {
        return;
      }

      try {
        await removeUserMutation.mutateAsync({ userId });
        toast.success('User deleted.');
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete user.');
      }
    },
    [refresh, removeUserMutation],
  );

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">
              {row.original.name.trim() === '' ? 'Unnamed user' : row.original.name}
            </div>
            <div className="text-muted-foreground text-xs">{row.original.email}</div>
          </div>
        ),
        enableColumnFilter: true,
        header: 'User',
        meta: {
          label: 'User',
          placeholder: 'Search users',
          variant: 'text',
        },
      },
      {
        accessorKey: 'role',
        cell: ({ row }) => (
          <Badge variant={row.original.role === 'admin' ? 'default' : 'secondary'}>
            {row.original.role === 'admin' ? 'Sysadmin' : 'User'}
          </Badge>
        ),
        header: 'Role',
      },
      {
        accessorKey: 'emailVerified',
        cell: ({ row }) => (
          <Badge variant={row.original.emailVerified ? 'secondary' : 'outline'}>
            {row.original.emailVerified ? 'Verified' : 'Pending'}
          </Badge>
        ),
        header: 'Email',
      },
      {
        accessorKey: 'banned',
        cell: ({ row }) => describeBanState(row.original),
        header: 'Status',
      },
      {
        accessorKey: 'createdAt',
        cell: ({ row }) => formatDateTime(row.original.createdAt),
        header: 'Created',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <MutationModal
              customDescription="Change Better Auth system role only. Scoped hierarchy admins should stay on system role user."
              defaultValues={{
                role: row.original.role === 'admin' ? 'admin' : 'user',
                userId: row.original.id,
              }}
              fields={[
                {
                  label: 'System role',
                  name: 'role',
                  options: [
                    { label: 'User', value: 'user' },
                    { label: 'Admin (sysadmin)', value: 'admin' },
                  ],
                  type: 'select',
                },
              ]}
              mutation={setUserRoleMutation}
              refresh={refresh}
              schema={setUserRoleSchema}
              submitButtonText="Update role"
              successToast={() => 'System role updated.'}
              titleText="Change system role"
              trigger={
                <Button size="sm" type="button" variant="outline">
                  Role
                </Button>
              }
            />
            <MutationModal
              defaultValues={{
                newPassword: DEFAULT_PASSWORD,
                userId: row.original.id,
              }}
              fields={[{ label: 'Password', name: 'newPassword', type: 'password' }]}
              mutation={resetPasswordMutation}
              refresh={refresh}
              schema={resetPasswordSchema}
              submitButtonText="Reset password"
              successToast={() => 'Password reset.'}
              titleText="Reset password"
              trigger={
                <Button size="sm" type="button" variant="outline">
                  Password
                </Button>
              }
            />
            {row.original.banned === true ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  void handleUnban(row.original.id);
                }}
              >
                Unban
              </Button>
            ) : (
              <MutationModal
                defaultValues={{
                  banExpiresIn: BAN_DAY_SECONDS,
                  banReason: 'Scoped access suspended.',
                  userId: row.original.id,
                }}
                fields={[
                  { label: 'Ban reason', name: 'banReason', type: 'textarea' },
                  {
                    description: '0 means indefinite ban.',
                    label: 'Ban duration (seconds)',
                    name: 'banExpiresIn',
                    type: 'number',
                  },
                ]}
                mutation={banUserMutation}
                refresh={refresh}
                schema={banUserSchema}
                submitButtonText="Ban user"
                successToast={() => 'User banned and sessions revoked.'}
                titleText="Ban user"
                trigger={
                  <Button size="sm" type="button" variant="outline">
                    Ban
                  </Button>
                }
              />
            )}
            <Button
              size="sm"
              type="button"
              variant="destructive"
              onClick={() => {
                void handleDelete(row.original.email, row.original.id);
              }}
            >
              Delete
            </Button>
          </div>
        ),
        header: 'Actions',
      },
    ],
    [
      banUserMutation,
      handleDelete,
      handleUnban,
      refresh,
      resetPasswordMutation,
      setUserRoleMutation,
    ],
  );

  return (
    <AccessControlShell
      currentTab="users"
      description="Global user lifecycle controls backed by Better Auth admin plugin, with server-side pagination for large user directories."
      navigation={data.navigation}
      stats={
        <>
          <StatCard
            description="Users matching the active server-side filter."
            title="Users"
            value={data.stats.userCount}
          />
          <StatCard
            description="Accounts with sysadmin system role."
            title="Sysadmins"
            value={data.stats.adminCount}
          />
          <StatCard
            description="Accounts currently banned."
            title="Banned"
            value={data.stats.bannedCount}
          />
          <StatCard
            description="Accounts with verified email state."
            title="Verified"
            value={data.stats.verifiedCount}
          />
        </>
      }
      title="Users"
    >
      <Card className="border">
        <CardHeader className="border-b">
          <CardTitle className="text-base">User Directory</CardTitle>
          <CardDescription>
            Better Auth system-role and lifecycle controls. Scoped access assignment lives on the
            hierarchy tabs.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <ServerDataTable
            columns={columns}
            data={data.table.rows}
            pageCount={data.table.pageCount}
            toolbarChildren={
              <MutationModal
                customDescription="Use system role user for normal operators. Use system role admin only for real sysadmins."
                defaultValues={{
                  email: '',
                  emailVerified: true,
                  name: '',
                  password: DEFAULT_PASSWORD,
                  role: 'user',
                }}
                fields={[
                  { label: 'Name', name: 'name', type: 'input' },
                  { label: 'Email', name: 'email', type: 'email' },
                  { label: 'Password', name: 'password', type: 'password' },
                  {
                    label: 'System role',
                    name: 'role',
                    options: [
                      { label: 'User', value: 'user' },
                      { label: 'Admin (sysadmin)', value: 'admin' },
                    ],
                    type: 'select',
                  },
                  { label: 'Mark email verified', name: 'emailVerified', type: 'checkbox' },
                ]}
                mutation={createUserMutation}
                refresh={refresh}
                schema={createUserSchema}
                submitButtonText="Create user"
                successToast={() => 'User created.'}
                titleText="Create user"
                trigger={<Button type="button">Create user</Button>}
              />
            }
          />
        </CardContent>
      </Card>
    </AccessControlShell>
  );
};
