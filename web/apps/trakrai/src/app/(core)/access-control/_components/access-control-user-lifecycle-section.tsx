'use client';

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@trakrai/design-system/components/table';
import { toast } from 'sonner';

import {
  BAN_DAY_SECONDS,
  DEFAULT_PASSWORD,
  type BanUserValues,
  banUserSchema,
  type CreateUserValues,
  createUserSchema,
  describeBanState,
  type MutationLike,
  type ResetPasswordValues,
  resetPasswordSchema,
  type SetUserRoleValues,
  setUserRoleSchema,
  type UserIdValues,
  type UserTableRow,
} from './access-control-page-lib';

type Props = {
  banUserMutation: MutationLike<BanUserValues>;
  createUserMutation: MutationLike<CreateUserValues>;
  isSysadmin: boolean;
  refreshConsole: () => Promise<void>;
  removeUserMutation: MutationLike<UserIdValues>;
  resetPasswordMutation: MutationLike<ResetPasswordValues>;
  setUserRoleMutation: MutationLike<SetUserRoleValues>;
  unbanUserMutation: MutationLike<UserIdValues>;
  userRows: UserTableRow[];
};

export const AccessControlUserLifecycleSection = ({
  banUserMutation,
  createUserMutation,
  isSysadmin,
  refreshConsole,
  removeUserMutation,
  resetPasswordMutation,
  setUserRoleMutation,
  unbanUserMutation,
  userRows,
}: Props) => (
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">User lifecycle</CardTitle>
      <CardDescription>
        Better Auth admin plugin controls global user accounts. Scoped admins only manage
        assignments.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 py-6">
      <div className="flex flex-wrap gap-2">
        {isSysadmin ? (
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
            refresh={refreshConsole}
            schema={createUserSchema}
            submitButtonText="Create user"
            successToast={() => 'User created.'}
            titleText="Create user"
            trigger={<Button type="button">Create user</Button>}
          />
        ) : (
          <div className="text-muted-foreground text-sm">
            Scoped admin can assign users inside owned subtree. Sysadmin handles account creation,
            auth role, bans, and password resets.
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>System role</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assignments</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {userRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">
                  {row.name.trim() === '' ? 'Unnamed user' : row.name}
                </div>
                <div className="text-muted-foreground text-xs">{row.email}</div>
              </TableCell>
              <TableCell>
                <Badge variant={row.role === 'admin' ? 'default' : 'secondary'}>
                  {row.role ?? 'user'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={row.emailVerified ? 'secondary' : 'outline'}>
                  {row.emailVerified ? 'Verified' : 'Pending'}
                </Badge>
              </TableCell>
              <TableCell>{describeBanState(row)}</TableCell>
              <TableCell>{row.assignmentCount}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {isSysadmin ? (
                    <>
                      <MutationModal
                        customDescription="Change Better Auth system role only. Scoped factory or department admins should keep system role user."
                        defaultValues={{
                          role: row.role === 'admin' ? 'admin' : 'user',
                          userId: row.id,
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
                        refresh={refreshConsole}
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
                          userId: row.id,
                        }}
                        fields={[{ label: 'Password', name: 'newPassword', type: 'password' }]}
                        mutation={resetPasswordMutation}
                        refresh={refreshConsole}
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
                      {row.banned === true ? (
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => {
                            void unbanUserMutation
                              .mutateAsync({ userId: row.id })
                              .then(() => {
                                toast.success('User unbanned.');
                                return refreshConsole();
                              })
                              .catch((error) => {
                                toast.error(
                                  error instanceof Error ? error.message : 'Failed to unban user.',
                                );
                              });
                          }}
                        >
                          Unban
                        </Button>
                      ) : (
                        <MutationModal
                          defaultValues={{
                            banExpiresIn: BAN_DAY_SECONDS,
                            banReason: 'Scoped access suspended.',
                            userId: row.id,
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
                          refresh={refreshConsole}
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
                          if (window.confirm(`Delete ${row.email}?`) === false) {
                            return;
                          }

                          void removeUserMutation
                            .mutateAsync({ userId: row.id })
                            .then(() => {
                              toast.success('User deleted.');
                              return refreshConsole();
                            })
                            .catch((error) => {
                              toast.error(
                                error instanceof Error ? error.message : 'Failed to delete user.',
                              );
                            });
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">Scoped admin view</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);
