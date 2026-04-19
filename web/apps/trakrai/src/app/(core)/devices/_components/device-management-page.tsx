'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Checkbox } from '@trakrai/design-system/components/checkbox';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { NativeSelect, NativeSelectOption } from '@trakrai/design-system/components/native-select';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useInvalidateQuery, useTRPCMutation, useTRPCQuery } from '@/server/react';

import type { RouterOutput } from '@trakrai/backend/server/routers';

type ManagedDevice = RouterOutput['devices']['list']['devices'][number];
type DeviceDraft = Readonly<{
  description: string;
  departmentId: string;
  isActive: boolean;
  name: string;
}>;

type CreateDeviceFormState = Readonly<{
  description: string;
  departmentId: string;
  name: string;
}>;

const createEmptyDeviceForm = (): CreateDeviceFormState => ({
  description: '',
  departmentId: '',
  name: '',
});

const EMPTY_DEPARTMENTS: RouterOutput['accessControl']['getManagementConsole']['departments'] = [];
const EMPTY_CATALOG: RouterOutput['accessControl']['getManagementConsole']['catalog'] = [];
const EMPTY_INSTALLATIONS: RouterOutput['accessControl']['getManagementConsole']['installations'] =
  [];

const createDeviceDraft = (device: ManagedDevice): DeviceDraft => ({
  description: device.description ?? '',
  departmentId: device.departmentId,
  isActive: device.isActive,
  name: device.name,
});

const formatTimestamp = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);

export const DeviceManagementPage = () => {
  const invalidateQuery = useInvalidateQuery();
  const devicesQuery = useTRPCQuery((api) => ({
    ...api.devices.list.queryOptions(),
    retry: false,
  }));
  const managementConsoleQuery = useTRPCQuery((api) => ({
    ...api.accessControl.getManagementConsole.queryOptions(),
    retry: false,
  }));
  const [createForm, setCreateForm] = useState<CreateDeviceFormState>(createEmptyDeviceForm);
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>({});

  const createMutation = useTRPCMutation((api) => api.devices.create.mutationOptions());
  const updateMutation = useTRPCMutation((api) => api.devices.update.mutationOptions());
  const deleteMutation = useTRPCMutation((api) => api.devices.delete.mutationOptions());

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard.`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  const refreshDevices = async () => {
    await invalidateQuery((api) => api.devices.list);
  };

  const departments = managementConsoleQuery.data?.departments ?? EMPTY_DEPARTMENTS;
  const catalog = managementConsoleQuery.data?.catalog ?? EMPTY_CATALOG;
  const installations = managementConsoleQuery.data?.installations ?? EMPTY_INSTALLATIONS;
  const departmentNameById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );
  const routeLinksByDeviceId = useMemo(() => {
    const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
    const linksByDeviceId = new Map<
      string,
      Array<{
        href: string;
        label: string;
        sortOrder: number;
      }>
    >();

    for (const installation of installations) {
      if (!installation.enabled) {
        continue;
      }

      const catalogEntry = catalogByKey.get(installation.componentKey);
      const routePath = catalogEntry?.routePath?.trim() ?? '';
      if (routePath === '') {
        continue;
      }

      const currentLinks = linksByDeviceId.get(installation.deviceId) ?? [];
      currentLinks.push({
        href: `/devices/${installation.deviceId}/${routePath}`,
        label:
          catalogEntry?.navigationLabel ?? catalogEntry?.displayName ?? installation.componentKey,
        sortOrder: catalogEntry?.sortOrder ?? 0,
      });
      linksByDeviceId.set(installation.deviceId, currentLinks);
    }

    for (const currentLinks of linksByDeviceId.values()) {
      currentLinks.sort((left, right) => {
        const sortOrderDifference = left.sortOrder - right.sortOrder;
        return sortOrderDifference !== 0
          ? sortOrderDifference
          : left.label.localeCompare(right.label);
      });
    }

    return linksByDeviceId;
  }, [catalog, installations]);
  const selectedDepartmentId =
    createForm.departmentId !== '' ? createForm.departmentId : (departments[0]?.id ?? '');

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync({
        description: createForm.description,
        departmentId: selectedDepartmentId,
        name: createForm.name,
      });
      toast.success('Device created.');
      setCreateForm(createEmptyDeviceForm());
      await refreshDevices();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create device.');
    }
  };

  const handleSave = async (device: ManagedDevice) => {
    const draft = drafts[device.id] ?? createDeviceDraft(device);

    try {
      await updateMutation.mutateAsync({
        description: draft.description,
        departmentId: draft.departmentId,
        id: device.id,
        isActive: draft.isActive,
        name: draft.name,
      });
      toast.success(`Saved ${device.deviceId}.`);
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [device.id]: draft,
      }));
      await refreshDevices();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save device.');
    }
  };

  const handleDelete = async (device: ManagedDevice) => {
    if (
      window.confirm(`Delete ${device.deviceId}? This removes the fixed access token as well.`) ===
      false
    ) {
      return;
    }

    try {
      await deleteMutation.mutateAsync({ id: device.id });
      toast.success(`Deleted ${device.deviceId}.`);
      setDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[device.id];
        return nextDrafts;
      });
      await refreshDevices();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete device.');
    }
  };

  const devices = devicesQuery.data?.devices ?? [];
  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const isUnauthorized = devicesQuery.error?.message === 'UNAUTHORIZED';
  const loadError =
    devicesQuery.error instanceof Error ? devicesQuery.error.message : 'Failed to load devices.';

  return (
    <div className="space-y-4">
      {isUnauthorized ? (
        <div className="border border-amber-500/30 bg-amber-500/10 p-3 text-amber-900">
          Sign in to manage registered devices and view their fixed access tokens.{' '}
          <Link className="underline underline-offset-4" href="/auth/login?redirect=/devices">
            Go to login
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Create device</CardTitle>
            <CardDescription>
              Register a cloud-managed device and mint its fixed bearer token in one step.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="device-create-name">Device name</Label>
              <Input
                disabled={isUnauthorized}
                id="device-create-name"
                value={createForm.name}
                onChange={(event) => {
                  setCreateForm((currentForm) => ({
                    ...currentForm,
                    name: event.target.value,
                  }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-create-department">Department</Label>
              <NativeSelect
                disabled={isUnauthorized || departments.length === 0}
                id="device-create-department"
                value={selectedDepartmentId}
                onChange={(event) => {
                  setCreateForm((currentForm) => ({
                    ...currentForm,
                    departmentId: event.target.value,
                  }));
                }}
              >
                {departments.length === 0 ? (
                  <NativeSelectOption value="">No departments available</NativeSelectOption>
                ) : null}
                {departments.map((department) => (
                  <NativeSelectOption key={department.id} value={department.id}>
                    {department.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-create-description">Description</Label>
              <Input
                disabled={isUnauthorized}
                id="device-create-description"
                placeholder="Optional notes about placement or purpose"
                value={createForm.description}
                onChange={(event) => {
                  setCreateForm((currentForm) => ({
                    ...currentForm,
                    description: event.target.value,
                  }));
                }}
              />
            </div>
            <Button
              className="w-full"
              disabled={
                isUnauthorized ||
                isBusy ||
                createForm.name.trim() === '' ||
                selectedDepartmentId.trim() === ''
              }
              type="button"
              onClick={() => {
                void handleCreate();
              }}
            >
              <Plus />
              Create device
            </Button>
            <div className="text-muted-foreground text-[11px]">
              The access token is generated server-side and stays fixed unless the device record is
              replaced.
            </div>
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Managed devices</CardTitle>
            <CardDescription>
              Stored device identities and their bearer tokens for cloud-to-device authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 py-6">
            {devicesQuery.isLoading ? (
              <div className="text-muted-foreground">Loading devices...</div>
            ) : null}

            {!devicesQuery.isLoading && devicesQuery.error !== null ? (
              <div className="border-destructive/30 bg-destructive/5 text-destructive border p-3">
                {loadError}
              </div>
            ) : null}

            {!devicesQuery.isLoading && devicesQuery.error === null && devices.length === 0 ? (
              <div className="text-muted-foreground border border-dashed p-4">
                No devices yet. Create the first one to issue a fixed access token.
              </div>
            ) : null}

            {devices.map((device) => {
              const draft = drafts[device.id] ?? createDeviceDraft(device);
              const routeLinks = routeLinksByDeviceId.get(device.id) ?? [];

              return (
                <section key={device.id} className="border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{device.deviceId}</div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        Created {formatTimestamp(device.createdAt)}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {device.factoryName} /{' '}
                        {departmentNameById.get(draft.departmentId) ?? 'Unknown'}
                      </div>
                    </div>
                    <div
                      className={`border px-2 py-1 text-[10px] tracking-[0.2em] uppercase ${
                        draft.isActive
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {draft.isActive ? 'Active' : 'Paused'}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`${device.id}-name`}>Device name</Label>
                      <Input
                        id={`${device.id}-name`}
                        value={draft.name}
                        onChange={(event) => {
                          setDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [device.id]: {
                              ...draft,
                              name: event.target.value,
                            },
                          }));
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${device.id}-token`}>Access token</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`${device.id}-token`}
                          readOnly
                          value={device.accessToken ?? ''}
                        />
                        <Button
                          disabled={device.accessToken === null}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (device.accessToken === null) {
                              return;
                            }
                            void handleCopy(
                              device.accessToken,
                              `Access token for ${device.deviceId}`,
                            );
                          }}
                        >
                          <Copy />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${device.id}-department`}>Department</Label>
                      <NativeSelect
                        id={`${device.id}-department`}
                        value={draft.departmentId}
                        onChange={(event) => {
                          setDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [device.id]: {
                              ...draft,
                              departmentId: event.target.value,
                            },
                          }));
                        }}
                      >
                        {departments.map((department) => (
                          <NativeSelectOption key={department.id} value={department.id}>
                            {department.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor={`${device.id}-description`}>Description</Label>
                      <Input
                        id={`${device.id}-description`}
                        value={draft.description}
                        onChange={(event) => {
                          setDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [device.id]: {
                              ...draft,
                              description: event.target.value,
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <label
                      className="flex items-center gap-2 text-xs"
                      htmlFor={`${device.id}-active`}
                    >
                      <Checkbox
                        checked={draft.isActive}
                        id={`${device.id}-active`}
                        onCheckedChange={(checked) => {
                          setDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [device.id]: {
                              ...draft,
                              isActive: checked === true,
                            },
                          }));
                        }}
                      />
                      Active and allowed to authenticate
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild type="button" variant="outline">
                        <Link href={`/devices/${device.id}`}>Open</Link>
                      </Button>
                      {routeLinks.map((routeLink) => (
                        <Button key={routeLink.href} asChild type="button" variant="outline">
                          <Link href={routeLink.href}>{routeLink.label}</Link>
                        </Button>
                      ))}
                      <Button
                        disabled={
                          isBusy || draft.name.trim() === '' || draft.departmentId.trim() === ''
                        }
                        type="button"
                        variant="outline"
                        onClick={() => {
                          void handleSave(device);
                        }}
                      >
                        <Save />
                        Save
                      </Button>
                      <Button
                        disabled={isBusy}
                        type="button"
                        variant="destructive"
                        onClick={() => {
                          void handleDelete(device);
                        }}
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    </div>
                  </div>
                </section>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
