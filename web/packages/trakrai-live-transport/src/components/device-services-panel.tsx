'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

import type { DeviceStatus } from '../lib/live-types';

import {
  formatHeartbeatAge,
  formatServiceDetails,
  formatUptime,
  getServiceStatusClasses,
} from '../lib/live-display-utils';

type DeviceServicesPanelProps = Readonly<{
  deviceStatus: DeviceStatus | null;
  heartbeatAgeSeconds: number | null;
  routeLabel: string;
}>;

export const DeviceServicesPanel = ({
  deviceStatus,
  heartbeatAgeSeconds,
  routeLabel,
}: DeviceServicesPanelProps) => {
  const serviceStatuses = Object.values(deviceStatus?.services ?? {});

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
            <div className="mt-1 text-sm font-medium break-all">{routeLabel}</div>
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
