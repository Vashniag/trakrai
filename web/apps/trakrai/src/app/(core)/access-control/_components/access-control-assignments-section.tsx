'use client';

import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
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
  type AssignmentTableRow,
  type ComponentAssignmentValues,
  componentAssignmentSchema,
  type DepartmentAssignmentValues,
  departmentAssignmentSchema,
  type DeviceAssignmentValues,
  deviceAssignmentSchema,
  type FactoryAssignmentValues,
  factoryAssignmentSchema,
  type MutationLike,
  type RemoveAssignmentValues,
  type SelectOption,
  toTitleCase,
} from './access-control-page-lib';

type Props = {
  assignmentRows: AssignmentTableRow[];
  departmentOptions: SelectOption[];
  deviceOptions: SelectOption[];
  factoryOptions: SelectOption[];
  installationOptions: SelectOption[];
  refreshConsole: () => Promise<void>;
  removeAssignmentMutation: MutationLike<RemoveAssignmentValues>;
  upsertAssignmentMutation: MutationLike<
    | FactoryAssignmentValues
    | DepartmentAssignmentValues
    | DeviceAssignmentValues
    | ComponentAssignmentValues
  >;
  userOptions: SelectOption[];
};

export const AccessControlAssignmentsSection = ({
  assignmentRows,
  departmentOptions,
  deviceOptions,
  factoryOptions,
  installationOptions,
  refreshConsole,
  removeAssignmentMutation,
  upsertAssignmentMutation,
  userOptions,
}: Props) => (
  <section className="space-y-4 border p-6">
    <h2 className="text-base font-semibold tracking-tight">Assignments</h2>
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <MutationModal
          defaultValues={{
            role: 'viewer',
            scopeId: factoryOptions[0]?.value ?? '',
            scopeType: 'factory',
            userId: userOptions[0]?.value ?? '',
          }}
          fields={[
            { label: 'User', name: 'userId', options: userOptions, type: 'select' },
            {
              label: 'Role',
              name: 'role',
              options: [
                { label: 'Viewer', value: 'viewer' },
                { label: 'Admin', value: 'admin' },
              ],
              type: 'select',
            },
            { label: 'Factory', name: 'scopeId', options: factoryOptions, type: 'select' },
          ]}
          mutation={upsertAssignmentMutation}
          refresh={refreshConsole}
          schema={factoryAssignmentSchema}
          submitButtonText="Assign factory scope"
          successToast={() => 'Factory assignment saved.'}
          titleText="Assign factory scope"
          trigger={<Button type="button">Factory scope</Button>}
        />
        <MutationModal
          defaultValues={{
            role: 'viewer',
            scopeId: departmentOptions[0]?.value ?? '',
            scopeType: 'department',
            userId: userOptions[0]?.value ?? '',
          }}
          fields={[
            { label: 'User', name: 'userId', options: userOptions, type: 'select' },
            {
              label: 'Role',
              name: 'role',
              options: [
                { label: 'Viewer', value: 'viewer' },
                { label: 'Admin', value: 'admin' },
              ],
              type: 'select',
            },
            { label: 'Department', name: 'scopeId', options: departmentOptions, type: 'select' },
          ]}
          mutation={upsertAssignmentMutation}
          refresh={refreshConsole}
          schema={departmentAssignmentSchema}
          submitButtonText="Assign department scope"
          successToast={() => 'Department assignment saved.'}
          titleText="Assign department scope"
          trigger={
            <Button type="button" variant="outline">
              Department scope
            </Button>
          }
        />
        <MutationModal
          defaultValues={{
            role: 'viewer',
            scopeId: deviceOptions[0]?.value ?? '',
            scopeType: 'device',
            userId: userOptions[0]?.value ?? '',
          }}
          fields={[
            { label: 'User', name: 'userId', options: userOptions, type: 'select' },
            { label: 'Device', name: 'scopeId', options: deviceOptions, type: 'select' },
          ]}
          mutation={upsertAssignmentMutation}
          refresh={refreshConsole}
          schema={deviceAssignmentSchema}
          submitButtonText="Assign device viewer"
          successToast={() => 'Device assignment saved.'}
          titleText="Assign device viewer scope"
          trigger={
            <Button type="button" variant="outline">
              Device scope
            </Button>
          }
        />
        <MutationModal
          defaultValues={{
            accessLevel: 'read',
            scopeId: installationOptions[0]?.value ?? '',
            scopeType: 'component',
            userId: userOptions[0]?.value ?? '',
          }}
          fields={[
            { label: 'User', name: 'userId', options: userOptions, type: 'select' },
            {
              label: 'Access',
              name: 'accessLevel',
              options: [
                { label: 'Read', value: 'read' },
                { label: 'Write', value: 'write' },
              ],
              type: 'select',
            },
            { label: 'Device app', name: 'scopeId', options: installationOptions, type: 'select' },
          ]}
          mutation={upsertAssignmentMutation}
          refresh={refreshConsole}
          schema={componentAssignmentSchema}
          submitButtonText="Assign app access"
          successToast={() => 'Device app assignment saved.'}
          titleText="Assign device app access"
          trigger={
            <Button type="button" variant="outline">
              Device app scope
            </Button>
          }
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Permission</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignmentRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">
                  {row.userName.trim() === '' ? 'Unnamed user' : row.userName}
                </div>
                <div className="text-muted-foreground text-xs">{row.userEmail}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{toTitleCase(row.scopeType)}</Badge>
              </TableCell>
              <TableCell>{row.scopeLabel}</TableCell>
              <TableCell>{row.permissionLabel}</TableCell>
              <TableCell>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void removeAssignmentMutation
                      .mutateAsync({
                        scopeId: row.scopeId,
                        scopeType: row.scopeType,
                        userId: row.userId,
                      })
                      .then(() => {
                        toast.success('Assignment removed.');
                        return refreshConsole();
                      })
                      .catch((error) => {
                        toast.error(
                          error instanceof Error ? error.message : 'Failed to remove assignment.',
                        );
                      });
                  }}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </section>
);
