'use client';

import { useDeferredValue, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@trakrai/design-system/components/dialog';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { NativeSelect, NativeSelectOption } from '@trakrai/design-system/components/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@trakrai/design-system/components/table';
import { toast } from 'sonner';

import { formatUserLabel } from '@/app/(core)/access-control/_components/access-control-page-lib';
import { useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type ScopeType = 'component' | 'department' | 'device' | 'factory';
type AssignmentRole = 'admin' | 'read' | 'viewer' | 'write';

type RoleOption = Readonly<{
  label: string;
  value: AssignmentRole;
}>;

type UserOption = RouterOutput['accessControl']['listAssignableUsers'][number];

type Props = Readonly<{
  roleOptions: readonly RoleOption[];
  scopeId: string;
  scopeLabel: string;
  scopeType: ScopeType;
  trigger?: React.ReactNode;
}>;

const roleLabel = (role: AssignmentRole) => {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'viewer':
      return 'Viewer';
    case 'read':
      return 'Read';
    case 'write':
      return 'Write';
  }
};

const buildAssignmentPayload = (
  scopeType: ScopeType,
  scopeId: string,
  selectedUserId: string,
  selectedRole: AssignmentRole,
) => {
  switch (scopeType) {
    case 'factory':
      return {
        role: selectedRole as 'admin' | 'viewer',
        scopeId,
        scopeType: 'factory' as const,
        userId: selectedUserId,
      };
    case 'department':
      return {
        role: selectedRole as 'admin' | 'viewer',
        scopeId,
        scopeType: 'department' as const,
        userId: selectedUserId,
      };
    case 'device':
      return {
        role: 'viewer' as const,
        scopeId,
        scopeType: 'device' as const,
        userId: selectedUserId,
      };
    case 'component':
      return {
        accessLevel: selectedRole as 'read' | 'write',
        scopeId,
        scopeType: 'component' as const,
        userId: selectedUserId,
      };
  }
};

export const AccessControlScopeManagerModal = ({
  roleOptions,
  scopeId,
  scopeLabel,
  scopeType,
  trigger,
}: Props) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const deferredUserSearch = useDeferredValue(userSearch);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>(
    roleOptions[0]?.value ?? 'viewer',
  );

  const assignMutation = useTRPCMutation((api) =>
    api.accessControl.upsertAssignment.mutationOptions(),
  );
  const removeMutation = useTRPCMutation((api) =>
    api.accessControl.removeAssignment.mutationOptions(),
  );

  const assignmentsQuery = useTRPCQuery((api) => ({
    ...api.accessControl.getScopeAssignments.queryOptions({
      scopeId,
      scopeType,
    }),
    enabled: open,
    retry: false,
  }));
  const usersQuery = useTRPCQuery((api) => ({
    ...api.accessControl.listAssignableUsers.queryOptions({
      limit: 20,
      query: deferredUserSearch,
    }),
    enabled: open,
    retry: false,
  }));

  const userOptions = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const canSubmit =
    selectedUserId.trim() !== '' &&
    selectedRole.trim() !== '' &&
    assignMutation.isPending === false;

  const selectedUser = useMemo(
    () => userOptions.find((userOption) => userOption.id === selectedUserId),
    [selectedUserId, userOptions],
  );

  const refreshScope = async () => {
    await assignmentsQuery.refetch();
    router.refresh();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setUserSearch('');
      setSelectedUserId('');
      setSelectedRole(roleOptions[0]?.value ?? 'viewer');
    }
  };

  const handleAssign = async () => {
    if (!canSubmit) {
      return;
    }

    try {
      await assignMutation.mutateAsync(
        buildAssignmentPayload(scopeType, scopeId, selectedUserId, selectedRole),
      );
      toast.success(`${roleLabel(selectedRole)} access saved for ${scopeLabel}.`);
      await refreshScope();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save assignment.');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeMutation.mutateAsync({
        scopeId,
        scopeType,
        userId,
      });
      toast.success(`Assignment removed from ${scopeLabel}.`);
      await refreshScope();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove assignment.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" type="button" variant="outline">
            Manage access
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription>
            Direct assignments for <span className="text-foreground font-medium">{scopeLabel}</span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor={`${scopeType}-${scopeId}-user-search`}>User search</Label>
            <Input
              id={`${scopeType}-${scopeId}-user-search`}
              placeholder="Search by name or email"
              value={userSearch}
              onChange={(event) => {
                setUserSearch(event.target.value);
              }}
            />
            <NativeSelect
              value={selectedUserId}
              onChange={(event) => {
                setSelectedUserId(event.target.value);
              }}
            >
              <NativeSelectOption value="">Select user</NativeSelectOption>
              {userOptions.map((userOption: UserOption) => (
                <NativeSelectOption key={userOption.id} value={userOption.id}>
                  {formatUserLabel(userOption)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${scopeType}-${scopeId}-role`}>Permission</Label>
            <NativeSelect
              id={`${scopeType}-${scopeId}-role`}
              value={selectedRole}
              onChange={(event) => {
                setSelectedRole(event.target.value as AssignmentRole);
              }}
            >
              {roleOptions.map((roleOption) => (
                <NativeSelectOption key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <Button disabled={!canSubmit} type="button" onClick={() => void handleAssign()}>
            Grant access
          </Button>
        </div>

        {selectedUser !== undefined ? (
          <div className="text-muted-foreground text-xs">
            Pending target: <span className="text-foreground">{formatUserLabel(selectedUser)}</span>
          </div>
        ) : null}

        <div className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead className="w-[7rem]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignmentsQuery.data?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">
                      {row.userName.trim() === '' ? 'Unnamed user' : row.userName}
                    </div>
                    <div className="text-muted-foreground text-xs">{row.userEmail}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{roleLabel(row.role)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => void handleRemove(row.userId)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {assignmentsQuery.isLoading ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={3}>
                    Loading assignments...
                  </TableCell>
                </TableRow>
              ) : null}
              {assignmentsQuery.isLoading === false &&
              (assignmentsQuery.data?.rows.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={3}>
                    No direct assignments on this scope.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
};
