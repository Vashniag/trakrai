'use client';

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

import {
  type CatalogValues,
  catalogSchema,
  type ManagementConsole,
  type MutationLike,
} from './access-control-page-lib';

type Props = {
  catalog: ManagementConsole['catalog'];
  createCatalogMutation: MutationLike<CatalogValues>;
  installations: ManagementConsole['installations'];
  isSysadmin: boolean;
  refreshConsole: () => Promise<void>;
  updateCatalogMutation: MutationLike<CatalogValues>;
};

export const AccessControlDeviceAppCatalogSection = ({
  catalog,
  createCatalogMutation,
  installations,
  isSysadmin,
  refreshConsole,
  updateCatalogMutation,
}: Props) => (
  <section className="space-y-4 border p-6">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Device app catalog</h2>
        {isSysadmin ? (
          <MutationModal
            defaultValues={{
              defaultEnabled: true,
              description: '',
              displayName: '',
              key: '',
              navigationLabel: '',
              readActions: [],
              rendererKey: '',
              routePath: '',
              serviceName: '',
              sortOrder: catalog.length,
              writeActions: [],
            }}
            fields={[
              { label: 'Catalog key', name: 'key', type: 'input' },
              { label: 'Display name', name: 'displayName', type: 'input' },
              { label: 'Navigation label', name: 'navigationLabel', type: 'input' },
              { label: 'Service name', name: 'serviceName', type: 'input' },
              { label: 'Renderer key', name: 'rendererKey', type: 'input' },
              { label: 'Route path', name: 'routePath', type: 'input' },
              { label: 'Read actions', name: 'readActions', type: 'stringArray' },
              { label: 'Write actions', name: 'writeActions', type: 'stringArray' },
              { label: 'Sort order', name: 'sortOrder', type: 'number' },
              { label: 'Default enabled', name: 'defaultEnabled', type: 'checkbox' },
              { label: 'Description', name: 'description', type: 'textarea' },
            ]}
            mutation={createCatalogMutation}
            refresh={refreshConsole}
            schema={catalogSchema}
            submitButtonText="Register app"
            successToast={() => 'Device app registered.'}
            titleText="Register device app"
            trigger={<Button type="button">Register app</Button>}
          />
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device app</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Route</TableHead>
            <TableHead>Installations</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {catalog.map((row) => {
            const installationCount = installations.filter(
              (installationRow) => installationRow.componentKey === row.key,
            ).length;

            return (
              <TableRow key={row.key}>
                <TableCell>
                  <div className="font-medium">{row.displayName}</div>
                  <div className="text-muted-foreground text-xs">{row.serviceName}</div>
                </TableCell>
                <TableCell>{row.key}</TableCell>
                <TableCell>{row.routePath ?? 'No route'}</TableCell>
                <TableCell>{installationCount}</TableCell>
                <TableCell>
                  {isSysadmin ? (
                    <MutationModal
                      defaultValues={{
                        defaultEnabled: row.defaultEnabled,
                        description: row.description ?? '',
                        displayName: row.displayName,
                        key: row.key,
                        navigationLabel: row.navigationLabel,
                        readActions: row.readActions,
                        rendererKey: row.rendererKey ?? '',
                        routePath: row.routePath ?? '',
                        serviceName: row.serviceName,
                        sortOrder: row.sortOrder,
                        writeActions: row.writeActions,
                      }}
                      fields={[
                        { label: 'Catalog key', name: 'key', type: 'input' },
                        { label: 'Display name', name: 'displayName', type: 'input' },
                        { label: 'Navigation label', name: 'navigationLabel', type: 'input' },
                        { label: 'Service name', name: 'serviceName', type: 'input' },
                        { label: 'Renderer key', name: 'rendererKey', type: 'input' },
                        { label: 'Route path', name: 'routePath', type: 'input' },
                        { label: 'Read actions', name: 'readActions', type: 'stringArray' },
                        { label: 'Write actions', name: 'writeActions', type: 'stringArray' },
                        { label: 'Sort order', name: 'sortOrder', type: 'number' },
                        { label: 'Default enabled', name: 'defaultEnabled', type: 'checkbox' },
                        { label: 'Description', name: 'description', type: 'textarea' },
                      ]}
                      mutation={updateCatalogMutation}
                      refresh={refreshConsole}
                      schema={catalogSchema}
                      submitButtonText="Save app"
                      successToast={() => 'Device app updated.'}
                      titleText="Edit device app"
                      trigger={
                        <Button size="sm" type="button" variant="outline">
                          Edit
                        </Button>
                      }
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">Read only</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  </section>
);
