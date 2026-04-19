'use client';

import { Separator } from '@trakrai/design-system/components/separator';

import type { ManagementConsole } from './access-control-page-lib';

type Props = {
  authz: ManagementConsole['authz'];
  departmentCount: number;
  deviceCount: number;
  factoryCount: number;
};

export const AccessControlHierarchySummary = ({
  authz,
  departmentCount,
  deviceCount,
  factoryCount,
}: Props) => (
  <section className="space-y-4 border p-6">
    <h2 className="text-base font-semibold tracking-tight">Hierarchy summary</h2>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ['Factories', factoryCount],
          ['Departments', departmentCount],
          ['Devices', deviceCount],
        ].map(([label, value]) => (
          <div key={label} className="border p-4">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              {label}
            </div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {authz !== null ? (
        <>
          <Separator />
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">OpenFGA store:</span> {authz.storeId}
            </div>
            <div>
              <span className="text-muted-foreground">Authorization model:</span>{' '}
              {authz.authorizationModelId}
            </div>
          </div>
        </>
      ) : null}
    </div>
  </section>
);
