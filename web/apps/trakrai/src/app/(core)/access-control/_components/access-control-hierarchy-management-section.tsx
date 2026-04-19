'use client';

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
  type CreateDepartmentValues,
  createDepartmentSchema,
  type CreateFactoryValues,
  createFactorySchema,
  type ManagementConsole,
  type MutationLike,
  type SelectOption,
  type UpdateDepartmentValues,
  updateDepartmentSchema,
  type UpdateFactoryValues,
  updateFactorySchema,
} from './access-control-page-lib';

type Props = {
  createDepartmentMutation: MutationLike<CreateDepartmentValues>;
  createFactoryMutation: MutationLike<CreateFactoryValues>;
  departments: ManagementConsole['departments'];
  factories: ManagementConsole['factories'];
  factoryOptions: SelectOption[];
  isSysadmin: boolean;
  refreshConsole: () => Promise<void>;
  updateDepartmentMutation: MutationLike<UpdateDepartmentValues>;
  updateFactoryMutation: MutationLike<UpdateFactoryValues>;
};

export const AccessControlHierarchyManagementSection = ({
  createDepartmentMutation,
  createFactoryMutation,
  departments,
  factories,
  factoryOptions,
  isSysadmin,
  refreshConsole,
  updateDepartmentMutation,
  updateFactoryMutation,
}: Props) => (
  <Card className="border">
    <CardHeader className="border-b">
      <CardTitle className="text-base">Hierarchy management</CardTitle>
      <CardDescription>
        Sysadmin owns structure. Factory and department admins inherit narrowed visibility from this
        tree.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-5 py-6">
      {isSysadmin ? (
        <div className="flex flex-wrap gap-2">
          <MutationModal
            defaultValues={{
              description: '',
              name: '',
            }}
            fields={[
              { label: 'Name', name: 'name', type: 'input' },
              { label: 'Description', name: 'description', type: 'textarea' },
            ]}
            mutation={createFactoryMutation}
            refresh={refreshConsole}
            schema={createFactorySchema}
            submitButtonText="Create factory"
            successToast={() => 'Factory created.'}
            titleText="Create factory"
            trigger={<Button type="button">Create factory</Button>}
          />
          <MutationModal
            defaultValues={{
              description: '',
              factoryId: factoryOptions[0]?.value ?? '',
              name: '',
            }}
            fields={[
              { label: 'Name', name: 'name', type: 'input' },
              {
                label: 'Factory',
                name: 'factoryId',
                options: factoryOptions,
                type: 'select',
              },
              { label: 'Description', name: 'description', type: 'textarea' },
            ]}
            mutation={createDepartmentMutation}
            refresh={refreshConsole}
            schema={createDepartmentSchema}
            submitButtonText="Create department"
            successToast={() => 'Department created.'}
            titleText="Create department"
            trigger={
              <Button type="button" variant="outline">
                Create department
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {factories.map((factoryRow) => {
          const linkedDepartments = departments.filter(
            (departmentRow) => departmentRow.factoryId === factoryRow.id,
          );

          return (
            <Card key={factoryRow.id} className="border">
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{factoryRow.name}</CardTitle>
                    <CardDescription>
                      {factoryRow.description ?? 'No factory description.'}
                    </CardDescription>
                  </div>
                  {isSysadmin ? (
                    <MutationModal
                      defaultValues={{
                        description: factoryRow.description ?? '',
                        id: factoryRow.id,
                        name: factoryRow.name,
                      }}
                      fields={[
                        { label: 'Name', name: 'name', type: 'input' },
                        { label: 'Description', name: 'description', type: 'textarea' },
                      ]}
                      mutation={updateFactoryMutation}
                      refresh={refreshConsole}
                      schema={updateFactorySchema}
                      submitButtonText="Save factory"
                      successToast={() => 'Factory updated.'}
                      titleText="Edit factory"
                      trigger={
                        <Button size="sm" type="button" variant="outline">
                          Edit
                        </Button>
                      }
                    />
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 py-5">
                {linkedDepartments.length === 0 ? (
                  <div className="text-muted-foreground text-sm">No departments yet.</div>
                ) : (
                  linkedDepartments.map((departmentRow) => (
                    <div
                      key={departmentRow.id}
                      className="flex flex-wrap items-start justify-between gap-3 border p-3"
                    >
                      <div>
                        <div className="font-medium">{departmentRow.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {departmentRow.description ?? 'No department description.'}
                        </div>
                      </div>
                      {isSysadmin ? (
                        <MutationModal
                          defaultValues={{
                            description: departmentRow.description ?? '',
                            factoryId: departmentRow.factoryId,
                            id: departmentRow.id,
                            name: departmentRow.name,
                          }}
                          fields={[
                            { label: 'Name', name: 'name', type: 'input' },
                            {
                              label: 'Factory',
                              name: 'factoryId',
                              options: factoryOptions,
                              type: 'select',
                            },
                            { label: 'Description', name: 'description', type: 'textarea' },
                          ]}
                          mutation={updateDepartmentMutation}
                          refresh={refreshConsole}
                          schema={updateDepartmentSchema}
                          submitButtonText="Save department"
                          successToast={() => 'Department updated.'}
                          titleText="Edit department"
                          trigger={
                            <Button size="sm" type="button" variant="outline">
                              Edit
                            </Button>
                          }
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </CardContent>
  </Card>
);
