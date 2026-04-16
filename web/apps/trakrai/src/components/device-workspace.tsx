'use client';

import { useEffect, useMemo } from 'react';

import Link from 'next/link';

import { parseAsString, useQueryStates } from 'nuqs';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Blocks,
  Camera,
  ChartColumn,
  Gauge,
  Siren,
  SlidersHorizontal,
} from 'lucide-react';

import { LiveWorkspaceEmbed } from '@/components/live-workspace-embed';
import { api } from '@/server/react';

const queryParsers = {
  deviceId: parseAsString,
  panel: parseAsString,
};

const formatDate = (value: Date | string | null | undefined) => {
  if (!value) {
    return 'Never';
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const getPanelKey = (panel: {
  app: { key: string; metadata: Record<string, unknown> };
}) =>
  typeof panel.app.metadata.panelKey === 'string' ? panel.app.metadata.panelKey : panel.app.key;

const renderPanelIcon = (panelKey: string) => {
  switch (panelKey) {
    case 'ptz-controls':
      return SlidersHorizontal;
    case 'workflow-designer':
      return Blocks;
    case 'violation-viewer':
      return Siren;
    case 'tilt-viewer':
      return AlertTriangle;
    case 'charts':
      return ChartColumn;
    case 'stats':
      return Gauge;
    default:
      return Camera;
  }
};

const EventCard = ({
  detail,
  label,
  title,
}: {
  detail: string;
  label: string;
  title: string;
}) => (
  <div className="rounded-[22px] border border-border/70 bg-muted/30 p-4">
    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
      {label}
    </p>
    <p className="mt-2 text-base font-medium">{title}</p>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
  </div>
);

export const DeviceWorkspace = () => {
  const [params, setParams] = useQueryStates(queryParsers);
  const treeQuery = api.access.deviceTree.useQuery();

  const firstTreeDevice = treeQuery.data?.tree[0]?.factories[0]?.departments[0]?.devices[0] ?? null;
  const firstDevice = params.deviceId ? null : firstTreeDevice ?? treeQuery.data?.unassignedDevices[0] ?? null;
  const selectedDeviceId = params.deviceId ?? firstDevice?.id ?? null;

  useEffect(() => {
    if (!params.deviceId && firstDevice) {
      void setParams({ deviceId: firstDevice.id });
    }
  }, [firstDevice, params.deviceId, setParams]);

  const deviceQuery = api.access.deviceWorkspace.useQuery(
    { deviceId: selectedDeviceId ?? '' },
    { enabled: selectedDeviceId !== null },
  );

  const visiblePanels = useMemo(
    () =>
      (deviceQuery.data?.appPanels ?? []).filter((panel) => panel.isVisible && panel.isSupported),
    [deviceQuery.data?.appPanels],
  );
  const fallbackPanelKey = visiblePanels[0] ? getPanelKey(visiblePanels[0]) : null;
  const activePanelKey = params.panel ?? fallbackPanelKey;

  useEffect(() => {
    if (!activePanelKey && fallbackPanelKey) {
      void setParams({ panel: fallbackPanelKey });
      return;
    }

    if (activePanelKey && !visiblePanels.some((panel) => getPanelKey(panel) === activePanelKey) && fallbackPanelKey) {
      void setParams({ panel: fallbackPanelKey });
    }
  }, [activePanelKey, fallbackPanelKey, setParams, visiblePanels]);

  if (treeQuery.isLoading) {
    return <Card className="border-border/70 bg-background/85"><CardHeader><CardTitle>Loading devices</CardTitle></CardHeader></Card>;
  }

  if (treeQuery.error || !treeQuery.data) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/10">
        <CardHeader>
          <CardTitle className="text-rose-50">Unable to load devices</CardTitle>
          <CardDescription className="text-rose-100/85">{treeQuery.error?.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (treeQuery.data.counts.devices === 0) {
    return (
      <Card className="border-border/70 bg-background/88">
        <CardHeader>
          <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
            Device workspace
          </CardDescription>
          <CardTitle className="text-3xl">No accessible devices yet</CardTitle>
          <CardDescription className="max-w-2xl text-sm leading-6">
            Register a device and assign scope access so this workspace can render the hierarchy
            sidebar and device app panels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="rounded-full">
            <Link href="/admin/devices">
              Open device provisioning
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Card className="border-border/70 bg-background/88">
          <CardHeader className="border-b border-border/60">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
              Device hierarchy
            </CardDescription>
            <CardTitle className="text-2xl">Accessible devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {treeQuery.data.tree.map((headquarter) => (
              <div key={headquarter.id} className="space-y-3">
                <div className="rounded-[20px] border border-border/70 bg-muted/35 px-4 py-3">
                  <p className="text-sm font-medium">{headquarter.name}</p>
                </div>
                <div className="space-y-3 pl-2">
                  {headquarter.factories.map((factory) => (
                    <div key={factory.id} className="space-y-3">
                      <div className="rounded-[18px] border border-border/70 bg-background/70 px-4 py-3 text-sm">
                        {factory.name}
                      </div>
                      <div className="space-y-3 pl-3">
                        {factory.departments.map((department) => (
                          <div key={department.id} className="space-y-3">
                            <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                              {department.name}
                            </div>
                            <div className="space-y-2">
                              {department.devices.map((device) => (
                                <button
                                  key={device.id}
                                  className={cn(
                                    'flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition-colors',
                                    selectedDeviceId === device.id
                                      ? 'border-amber-400/70 bg-amber-400/12'
                                      : 'border-border/70 bg-background/80 hover:border-amber-400/40',
                                  )}
                                  type="button"
                                  onClick={() => {
                                    void setParams({ deviceId: device.id });
                                  }}
                                >
                                  <div>
                                    <p className="text-sm font-medium">{device.name}</p>
                                    <p className="text-xs text-muted-foreground">{device.publicId}</p>
                                  </div>
                                  <ArrowRight className="size-4 text-muted-foreground" />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {treeQuery.data.unassignedDevices.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Unassigned
                </div>
                {treeQuery.data.unassignedDevices.map((device) => (
                  <button
                    key={device.id}
                    className={cn(
                      'flex w-full items-center justify-between rounded-[18px] border px-4 py-3 text-left transition-colors',
                      selectedDeviceId === device.id
                        ? 'border-amber-400/70 bg-amber-400/12'
                        : 'border-border/70 bg-background/80 hover:border-amber-400/40',
                    )}
                    type="button"
                    onClick={() => {
                      void setParams({ deviceId: device.id });
                    }}
                  >
                    <div>
                      <p className="text-sm font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">{device.publicId}</p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      <section className="space-y-6">
        {deviceQuery.isLoading || !deviceQuery.data ? (
          <Card className="border-border/70 bg-background/88">
            <CardHeader>
              <CardTitle>Loading device workspace</CardTitle>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card className="border-border/70 bg-background/88">
              <CardHeader className="border-b border-border/60">
                <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
                  Device control center
                </CardDescription>
                <CardTitle className="text-3xl">{deviceQuery.data.device.name}</CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6">
                  {[
                    deviceQuery.data.hierarchy.headquarter?.name,
                    deviceQuery.data.hierarchy.factory?.name,
                    deviceQuery.data.hierarchy.department?.name,
                  ]
                    .filter(Boolean)
                    .join(' / ') || 'Unassigned device'}
                  {' · '}
                  {deviceQuery.data.device.publicId}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 pt-5 md:grid-cols-2 xl:grid-cols-4">
                <EventCard
                  detail="Latest heartbeat received from the registered device."
                  label="Last seen"
                  title={formatDate(deviceQuery.data.device.lastSeenAt)}
                />
                <EventCard
                  detail="Current registration state tracked in the cloud inventory."
                  label="Status"
                  title={deviceQuery.data.device.status}
                />
                <EventCard
                  detail="Visible app panels after support flags and grants are applied."
                  label="Panels"
                  title={String(visiblePanels.length)}
                />
                <EventCard
                  detail="Whether this account can control runtime or device-level app policy."
                  label="Management"
                  title={deviceQuery.data.permissions.canManageDevice ? 'Manage' : 'View'}
                />
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              {visiblePanels.map((panel) => {
                const panelKey = getPanelKey(panel);
                const Icon = renderPanelIcon(panelKey);
                const active = panelKey === activePanelKey;

                return (
                  <button
                    key={panel.app.id}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
                      active
                        ? 'border-amber-400/70 bg-amber-400/14 text-foreground'
                        : 'border-border/70 bg-background/80 text-muted-foreground hover:border-amber-400/40 hover:text-foreground',
                    )}
                    type="button"
                    onClick={() => {
                      void setParams({ panel: panelKey });
                    }}
                  >
                    <Icon className="size-4" />
                    {panel.app.name}
                  </button>
                );
              })}
            </div>

            {activePanelKey === 'workflow-designer' ? (
              <Card className="border-border/70 bg-background/88">
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-2xl">Workflow designer</CardTitle>
                  <CardDescription>
                    The device workflow engine now runs as its own process, fed from the Redis
                    frame queue rather than inside AI inference. This panel is the place where ROI
                    logic, send-to-cloud actions, and audio alert nodes will plug into the device
                    app surface.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5">
                  <div className="rounded-[22px] border border-border/70 bg-muted/30 p-5 text-sm leading-6 text-muted-foreground">
                    Workflow authoring is being rebuilt around the same scoped app model, so panel
                    visibility and device support can evolve without changing unrelated transport
                    services.
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {activePanelKey === 'violation-viewer' ? (
              <Card className="border-border/70 bg-background/88">
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-2xl">Violation viewer</CardTitle>
                  <CardDescription>
                    Recent violation events received for this device.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {deviceQuery.data.recentViolations.length === 0 ? (
                    <div className="rounded-[20px] border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
                      No violation events have been received for this device yet.
                    </div>
                  ) : (
                    deviceQuery.data.recentViolations.map((event) => (
                      <div key={event.id} className="rounded-[20px] border border-border/70 bg-muted/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{event.title}</p>
                          <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {event.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {event.summary ?? 'No summary available'}
                        </p>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {formatDate(event.occurredAt)}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {activePanelKey === 'tilt-viewer' ? (
              <Card className="border-border/70 bg-background/88">
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-2xl">Tilt viewer</CardTitle>
                  <CardDescription>Recent tilt events and angle metadata for this device.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {deviceQuery.data.recentTilts.length === 0 ? (
                    <div className="rounded-[20px] border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
                      No tilt events have been received for this device yet.
                    </div>
                  ) : (
                    deviceQuery.data.recentTilts.map((event) => (
                      <div key={event.id} className="rounded-[20px] border border-border/70 bg-muted/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">{event.title}</p>
                          <span className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {event.angle ?? 'No angle'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {event.summary ?? 'No summary available'}
                        </p>
                        <p className="mt-3 text-xs text-muted-foreground">
                          {formatDate(event.occurredAt)}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {activePanelKey === 'charts' || activePanelKey === 'stats' ? (
              <Card className="border-border/70 bg-background/88">
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-2xl">
                    {activePanelKey === 'charts' ? 'Charts' : 'Stats'}
                  </CardTitle>
                  <CardDescription>
                    Quick operational summary derived from the device event lanes and current app
                    visibility.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 pt-5 md:grid-cols-3">
                  <EventCard
                    detail="Violation events currently attached to this device."
                    label="Violations"
                    title={String(deviceQuery.data.recentViolations.length)}
                  />
                  <EventCard
                    detail="Tilt events currently attached to this device."
                    label="Tilts"
                    title={String(deviceQuery.data.recentTilts.length)}
                  />
                  <EventCard
                    detail="Panels visible after scope and ACL evaluation."
                    label="Visible panels"
                    title={String(visiblePanels.length)}
                  />
                </CardContent>
              </Card>
            ) : null}

            {(!activePanelKey ||
              activePanelKey === 'live-feed' ||
              activePanelKey === 'ptz-controls' ||
              activePanelKey === 'runtime-control') ? (
              <Card className="border-border/70 bg-background/88">
                <CardHeader className="border-b border-border/60">
                  <CardTitle className="text-2xl">
                    {activePanelKey === 'runtime-control'
                      ? 'Runtime control'
                      : activePanelKey === 'ptz-controls'
                        ? 'PTZ and live control'
                        : 'Live feed'}
                  </CardTitle>
                  <CardDescription>
                    Shared live workspace with camera inventory, WebRTC diagnostics, PTZ controls,
                    and runtime manager panels.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5">
                  <LiveWorkspaceEmbed deviceId={deviceQuery.data.device.publicId} />
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
};
