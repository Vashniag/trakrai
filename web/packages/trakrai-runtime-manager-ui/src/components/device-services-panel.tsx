'use client';

import { useMemo } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import {
  formatHeartbeatAge,
  formatServiceDetails,
  formatUptime,
  getServiceStatusClasses,
} from '@trakrai/live-transport/lib/live-display-utils';
import { useLiveTransport } from '@trakrai/live-transport/providers/live-transport-provider';

import type { ManagedRuntimeService } from '@trakrai/live-transport/lib/runtime-manager-types';

type DeviceServicesPanelProps = Readonly<{
  managedServices?: ManagedRuntimeService[];
}>;

const buildManagedServiceDetails = (service: ManagedRuntimeService): Record<string, unknown> => {
  const details: Record<string, unknown> = {
    kind: service.kind,
  };

  if (service.version !== undefined && service.version !== '') {
    details.version = service.version;
  }
  if (service.mainPid !== undefined) {
    details.pid = service.mainPid;
  }
  if (service.unitFileState !== undefined && service.unitFileState !== '') {
    details.unit = service.unitFileState;
  }
  if (service.subState !== undefined && service.subState !== '') {
    details.subState = service.subState;
  }

  return details;
};

export const DeviceServicesPanel = ({ managedServices = [] }: DeviceServicesPanelProps) => {
  const { deviceStatus, heartbeatAgeSeconds, httpBaseUrl } = useLiveTransport();
  const serviceStatuses = useMemo(() => {
    const mergedStatuses = new Map(Object.entries(deviceStatus?.services ?? {}));

    for (const service of managedServices) {
      if (mergedStatuses.has(service.name)) {
        continue;
      }

      mergedStatuses.set(service.name, {
        details: buildManagedServiceDetails(service),
        service: service.name,
        status: service.state,
      });
    }

    return Array.from(mergedStatuses.values()).sort((left, right) =>
      left.service.localeCompare(right.service),
    );
  }, [deviceStatus?.services, managedServices]);

  return (
    <Card className="border">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Device services</CardTitle>
        <CardDescription>
          Heartbeats, route metadata, and the current service-state snapshot from the device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Last heartbeat
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatHeartbeatAge(heartbeatAgeSeconds)}
            </div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Uptime
            </div>
            <div className="mt-1 text-sm font-medium">{formatUptime(deviceStatus?.uptime)}</div>
          </div>
          <div className="border p-3">
            <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
              Route
            </div>
            <div className="mt-1 text-sm font-medium break-all">{httpBaseUrl}</div>
          </div>
        </div>

        <div className="space-y-2">
          {serviceStatuses.length > 0 ? (
            serviceStatuses.map((serviceStatus) => {
              const details = formatServiceDetails(serviceStatus.details);

              return (
                <div
                  key={serviceStatus.service}
                  className="flex items-start justify-between gap-3 border px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{serviceStatus.service}</div>
                    {details !== null ? (
                      <div className="text-muted-foreground mt-1 text-[11px]">{details}</div>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 border px-2 py-1 text-[10px] tracking-[0.18em] uppercase ${getServiceStatusClasses(serviceStatus.status)}`}
                  >
                    {serviceStatus.status}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="text-muted-foreground border px-3 py-2 text-xs">
              No service status has been published yet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
