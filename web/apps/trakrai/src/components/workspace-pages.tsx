'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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
  ArrowUpRight,
  BarChart3,
  Camera,
  MonitorCog,
  Move3D,
  Radar,
  Siren,
  Workflow,
} from 'lucide-react';

import { api } from '@/server/react';

import type { RouterOutput } from '@/server/routers';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type DeviceRow = RouterOutput['devices']['list']['devices'][number];
type EventRow = RouterOutput['events']['summary']['recentEvents'][number];

type DevicePanelKey =
  | 'analytics'
  | 'live'
  | 'ptz'
  | 'runtime'
  | 'tilt'
  | 'violations'
  | 'workflow';

type DevicePanelDefinition = {
  description: string;
  icon: LucideIcon;
  key: DevicePanelKey;
  label: string;
  tone: 'active' | 'planned';
};

const fieldClassName =
  'rounded-2xl border border-border/70 bg-background/55 p-4 text-sm text-muted-foreground';

const metricClasses = {
  active:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200',
  planned:
    'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100',
};

const devicePanels: DevicePanelDefinition[] = [
  {
    description: 'Live frames, operator view modes, and talkback entry points.',
    icon: Camera,
    key: 'live',
    label: 'Live feed',
    tone: 'active',
  },
  {
    description: 'Pan, tilt, zoom, presets, and pointing helpers.',
    icon: Move3D,
    key: 'ptz',
    label: 'PTZ controls',
    tone: 'active',
  },
  {
    description: 'Edge workflow editing, ROI logic, and cloud-send nodes.',
    icon: Workflow,
    key: 'workflow',
    label: 'Workflow designer',
    tone: 'planned',
  },
  {
    description: 'Violation review, media payloads, and operator handoff.',
    icon: Siren,
    key: 'violations',
    label: 'Violation viewer',
    tone: 'planned',
  },
  {
    description: 'Tilt drift history, threshold posture, and acknowledgement.',
    icon: Radar,
    key: 'tilt',
    label: 'Tilt viewer',
    tone: 'planned',
  },
  {
    description: 'Charts, counters, and operational trend surfaces.',
    icon: BarChart3,
    key: 'analytics',
    label: 'Charts and stats',
    tone: 'planned',
  },
  {
    description: 'Runtime manager, process posture, and service inspection.',
    icon: MonitorCog,
    key: 'runtime',
    label: 'Runtime panel',
    tone: 'active',
  },
];

const formatDate = (value: Date | string | null | undefined) => {
  if (!value) {
    return 'Never';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatRelative = (value: Date | string | null | undefined) => {
  if (!value) {
    return 'No recent check-in';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown timing';
  }

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const relativeFormatter = new Intl.RelativeTimeFormat('en', {
    numeric: 'auto',
  });

  if (absMs < 60_000) {
    return relativeFormatter.format(Math.round(diffMs / 1_000), 'second');
  }

  if (absMs < 3_600_000) {
    return relativeFormatter.format(Math.round(diffMs / 60_000), 'minute');
  }

  if (absMs < 86_400_000) {
    return relativeFormatter.format(Math.round(diffMs / 3_600_000), 'hour');
  }

  return relativeFormatter.format(Math.round(diffMs / 86_400_000), 'day');
};

const statusTone = (status: string | null | undefined) => {
  if (status === 'active') {
    return metricClasses.active;
  }

  return metricClasses.planned;
};

const PageFrame = ({
  eyebrow,
  summary,
  title,
  children,
}: {
  children: ReactNode;
  eyebrow: string;
  summary: string;
  title: string;
}) => (
  <div className="space-y-6">
    <Card className="border-primary/15 bg-card/80">
      <CardHeader className="border-b border-border/70">
        <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
          {eyebrow}
        </CardDescription>
        <CardTitle className="text-3xl text-foreground sm:text-4xl">{title}</CardTitle>
        <CardDescription className="max-w-3xl text-sm leading-relaxed">{summary}</CardDescription>
      </CardHeader>
    </Card>
    {children}
  </div>
);

const LoadingState = ({ label }: { label: string }) => (
  <Card className="border-border/70 bg-card/70">
    <CardContent className="p-5 text-sm text-muted-foreground">Loading {label}...</CardContent>
  </Card>
);

const EmptyState = ({
  actionHref,
  actionLabel,
  description,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  description: string;
  title: string;
}) => (
  <Card className="border-border/70 bg-card/70">
    <CardContent className="space-y-4 p-6">
      <div className="space-y-2">
        <p className="text-lg font-medium text-foreground">{title}</p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actionHref && actionLabel ? (
        <Button asChild className="border border-border/80 bg-background/70 text-foreground" variant="outline">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
    </CardContent>
  </Card>
);

const DashboardWorkspacePage = () => {
  const bootstrapQuery = api.admin.bootstrapStatus.useQuery();
  const healthQuery = api.health.useQuery();
  const isAdmin = bootstrapQuery.data?.isAdmin ?? false;
  const overviewQuery = api.admin.overview.useQuery(undefined, { enabled: isAdmin });
  const devicesQuery = api.devices.list.useQuery(undefined, { enabled: isAdmin });
  const eventsQuery = api.events.summary.useQuery(undefined, { enabled: isAdmin });

  if (bootstrapQuery.isLoading || healthQuery.isLoading) {
    return <LoadingState label="workspace summary" />;
  }

  const deviceCount = devicesQuery.data?.devices.length ?? 0;
  const eventCount =
    (eventsQuery.data?.counts.violationEvents ?? 0) + (eventsQuery.data?.counts.tiltEvents ?? 0);
  const overviewCounts = overviewQuery.data?.counts;
  const onboardingChecklist = [
    {
      detail: isAdmin
        ? `${overviewCounts?.headquarters ?? 0} hierarchy roots currently modeled.`
        : 'Hierarchy visibility will follow your scope assignments.',
      label: 'Business structure',
      value: isAdmin ? `${overviewCounts?.headquarters ?? 0} HQ` : 'Scoped',
    },
    {
      detail: isAdmin
        ? `${deviceCount} registered device identities are ready for operator surfaces.`
        : 'Your assigned devices will appear in the left rail once access-scoped APIs are wired.',
      label: 'Fleet access',
      value: isAdmin ? `${deviceCount} devices` : 'Pending scope feed',
    },
    {
      detail: isAdmin
        ? `${overviewCounts?.appDefinitions ?? 0} app definitions can drive which panels users see.`
        : 'Panel availability will come from ACL grants and app definitions.',
      label: 'App surfaces',
      value: isAdmin ? `${overviewCounts?.appDefinitions ?? 0} apps` : 'Policy-driven',
    },
  ];

  return (
    <PageFrame
      eyebrow="Dashboard"
      summary="This is the signed-in landing zone: summary first, then a straight path into the fleet and the admin surfaces layered around it."
      title="Operator summary"
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Role
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {isAdmin ? 'Site admin' : 'Workspace user'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            {isAdmin
              ? 'You can move between dashboard, devices, and the full admin control surfaces.'
              : 'You are inside the signed-in workspace. User-scoped device feeds will slot into this shell next.'}
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Cloud status
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{healthQuery.data?.status ?? '...'}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Health checks are live, so the dashboard can carry real posture signals from the platform.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Fleet view
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {isAdmin ? `${deviceCount} devices` : 'Role-scoped'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            The device hierarchy stays in the sidebar so switching into a device workspace is always one click away.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Event flow
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {isAdmin ? `${eventCount} records` : 'Cloud ingress ready'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Violations, tilt events, and file uploads are already shaping the cloud side of the workspace.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Summary lane
            </CardDescription>
            <CardTitle className="text-xl text-foreground">What this workspace is optimized for</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {onboardingChecklist.map((item) => (
              <div key={item.label} className={fieldClassName}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                      {item.label}
                    </p>
                    <p className="mt-2 text-sm text-foreground">{item.value}</p>
                  </div>
                  <ArrowUpRight className="size-4 text-primary/80" />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Quick actions
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Start here</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <Button asChild className="w-full justify-between border border-primary/35 bg-primary text-primary-foreground">
              <Link href="/devices">Open device workspace</Link>
            </Button>
            {isAdmin ? (
              <>
                <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                  <Link href="/hierarchy">Manage hierarchy</Link>
                </Button>
                <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                  <Link href="/users">Manage users and access</Link>
                </Button>
                <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                  <Link href="/apps">Configure app availability</Link>
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {isAdmin ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Recent fleet
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Newest device identities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {(devicesQuery.data?.devices ?? []).slice(0, 5).map((device) => (
                <Link
                  key={device.id}
                  className="grid gap-3 rounded-2xl border border-border/70 bg-background/55 p-4 transition-colors hover:border-primary/25 hover:bg-card"
                  href={`/devices/${device.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{device.name}</p>
                      <p className="text-xs text-muted-foreground">{device.publicId}</p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase',
                        statusTone(device.status),
                      )}
                    >
                      {device.status ?? 'unknown'}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="text-xs text-muted-foreground">
                      Headquarter
                      <p className="mt-1 text-sm text-foreground">{device.headquarterName ?? 'Unassigned'}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Factory
                      <p className="mt-1 text-sm text-foreground">{device.factoryName ?? 'Unassigned'}</p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last seen
                      <p className="mt-1 text-sm text-foreground">{formatRelative(device.lastSeenAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/80">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Admin posture
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Capability summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-sm text-muted-foreground">
              <div className={fieldClassName}>
                Higher-level admins can manage hierarchy, users, and panel availability from the
                admin lanes while still staying inside the same signed-in workspace shell.
              </div>
              <div className={fieldClassName}>
                Device workspaces are now structured to host live feed, PTZ, workflows, violations,
                tilt, charts, and runtime operations without changing route shape again later.
              </div>
              <div className={fieldClassName}>
                ACL and mixed-scope permission editing still needs dedicated backend endpoints, so
                the shell keeps those entry points visible without faking unsupported mutations.
              </div>
            </CardContent>
          </Card>
        </section>
      ) : (
        <EmptyState
          description="This dashboard already gives you the signed-in workspace frame. The next backend slice is user-scoped device trees and scoped summary cards, which will drop into this same UI without another structural rewrite."
          title="User-scoped data is the next backend milestone"
        />
      )}
    </PageFrame>
  );
};

const DeviceDirectoryPage = () => {
  const bootstrapQuery = api.admin.bootstrapStatus.useQuery();
  const isAdmin = bootstrapQuery.data?.isAdmin ?? false;
  const devicesQuery = api.devices.list.useQuery(undefined, { enabled: isAdmin });

  if (bootstrapQuery.isLoading || (isAdmin && devicesQuery.isLoading)) {
    return <LoadingState label="device directory" />;
  }

  if (!isAdmin) {
    return (
      <PageFrame
        eyebrow="Devices"
        summary="The left rail already reserves space for your accessible device tree. User-scoped device queries are the next backend handoff."
        title="Device access"
      >
        <EmptyState
          description="This signed-in shell is ready to host operator devices, but the current backend only exposes admin fleet queries. Once user-scoped access endpoints land, this page can render the same cards and device workspaces for non-admin users."
          title="Scoped device listing is waiting on backend access feeds"
        />
      </PageFrame>
    );
  }

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <PageFrame
      eyebrow="Fleet"
      summary="The sidebar remains the fastest path into a device, but this page gives admins a broader scan across the registered fleet."
      title="Device directory"
    >
      {devices.length === 0 ? (
        <EmptyState
          actionHref="/hierarchy"
          actionLabel="Set up hierarchy"
          description="Register a device and assign it into the business structure. As soon as it exists, it becomes selectable from the sidebar and gets its own workspace route."
          title="No device workspaces exist yet"
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {devices.map((device) => (
            <Card key={device.id} className="border-primary/10 bg-card/82">
              <CardHeader className="border-b border-border/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                      {device.publicId}
                    </CardDescription>
                    <CardTitle className="text-xl text-foreground">{device.name}</CardTitle>
                  </div>
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase',
                      statusTone(device.status),
                    )}
                  >
                    {device.status ?? 'unknown'}
                  </span>
                </div>
                <CardDescription className="text-sm">
                  {device.description ?? 'No description has been added for this device yet.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className={fieldClassName}>
                    <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                      Placement
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {device.headquarterName ?? 'Unassigned'} / {device.factoryName ?? 'Unassigned'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {device.departmentName ?? 'Unassigned department'}
                    </p>
                  </div>
                  <div className={fieldClassName}>
                    <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                      Last seen
                    </p>
                    <p className="mt-2 text-sm text-foreground">{formatDate(device.lastSeenAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatRelative(device.lastSeenAt)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild className="border border-primary/35 bg-primary text-primary-foreground">
                    <Link href={`/devices/${device.id}`}>Open workspace</Link>
                  </Button>
                  <Button asChild className="border border-border/80 bg-background/70 text-foreground" variant="outline">
                    <Link href={`/devices/${device.id}?panel=runtime`}>Open runtime panel</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </PageFrame>
  );
};

const DevicePanelTabs = ({
  activePanel,
  deviceId,
}: {
  activePanel: DevicePanelKey;
  deviceId: string;
}) => (
  <div className="flex flex-wrap gap-2">
    {devicePanels.map((panel) => {
      const Icon = panel.icon;
      const active = panel.key === activePanel;

      return (
        <Link
          key={panel.key}
          className={cn(
            'flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors',
            active
              ? 'border-primary/40 bg-primary/12 text-foreground'
              : 'border-border/70 bg-card/65 text-muted-foreground hover:border-primary/25 hover:text-foreground',
          )}
          href={`/devices/${deviceId}?panel=${panel.key}`}
        >
          <Icon className={cn('size-4', active ? 'text-primary' : 'text-primary/70')} />
          <span>{panel.label}</span>
        </Link>
      );
    })}
  </div>
);

const DeviceLivePanel = ({ device }: { device: DeviceRow }) => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        Live feed
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Operator camera stage</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 pt-4">
      <div className="flex aspect-[16/9] items-center justify-center rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top,rgba(247,197,60,0.16),transparent_30%),linear-gradient(180deg,rgba(14,15,18,0.92),rgba(5,6,8,0.98))]">
        <div className="space-y-3 text-center">
          <Camera className="mx-auto size-9 text-primary" />
          <p className="text-lg text-white dark:text-foreground">{device.name} live canvas</p>
          <p className="max-w-md text-sm text-slate-300 dark:text-muted-foreground">
            This surface is ready for the edge live feed bridge, talkback, and operator overlays.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Primary mode
          </p>
          <p className="mt-2 text-sm text-foreground">Full-frame operator view</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Overlay pack
          </p>
          <p className="mt-2 text-sm text-foreground">Detections, ROI masks, and workflow traces</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Talkback
          </p>
          <p className="mt-2 text-sm text-foreground">Audio service handoff ready</p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const DevicePTZPanel = () => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        PTZ controls
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Pointing, presets, and patrols</CardTitle>
    </CardHeader>
    <CardContent className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-[28px] border border-border/70 bg-background/55 p-5">
        <div className="mx-auto grid h-64 w-full max-w-[360px] place-items-center rounded-full border border-primary/20 bg-[radial-gradient(circle,rgba(247,197,60,0.12),transparent_58%)]">
          <div className="grid h-44 w-44 place-items-center rounded-full border border-border/70 bg-card/80">
            <Move3D className="size-10 text-primary" />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Presets
          </p>
          <p className="mt-2 text-sm text-foreground">Gate, loading bay, assembly line, dispatch</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Modes
          </p>
          <p className="mt-2 text-sm text-foreground">Manual steer, preset recall, auto patrol</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Future binding
          </p>
          <p className="mt-2 text-sm text-foreground">
            The same panel can attach to live controls already present in the edge UI.
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const DeviceWorkflowPanel = () => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        Workflow designer
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Edge logic in a dedicated process</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 pt-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Queue source
          </p>
          <p className="mt-2 text-sm text-foreground">Redis frame envelopes from AI inference</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            First nodes
          </p>
          <p className="mt-2 text-sm text-foreground">ROI, send violation to cloud, audio alerts</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Distribution
          </p>
          <p className="mt-2 text-sm text-foreground">Schema-driven editor parity is the next step</p>
        </div>
      </div>
      <div className="rounded-[28px] border border-border/70 bg-background/55 p-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This device route is already shaped like the future workflow studio host. When the editor
          surface is dropped in, it can reuse this tab without changing how operators reach it.
        </p>
      </div>
    </CardContent>
  </Card>
);

const DeviceEventsPanel = ({
  device,
  label,
  rows,
}: {
  device: DeviceRow;
  label: 'Tilt viewer' | 'Violation viewer';
  rows: EventRow[];
}) => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        {label}
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Business events for {device.name}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3 pt-4">
      {rows.length === 0 ? (
        <div className={fieldClassName}>
          No matching events have been ingested for this device yet. Once event records land, this
          tab can switch from shell copy to a true review surface.
        </div>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-border/70 bg-background/55 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{row.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.type} · {formatDate(row.createdAt)}
                </p>
              </div>
              <span className={cn('rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase', metricClasses.planned)}>
                {row.severity}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {row.summary ?? 'No summary was supplied with this event.'}
            </p>
          </div>
        ))
      )}
    </CardContent>
  </Card>
);

const DeviceAnalyticsPanel = ({
  device,
  eventRows,
}: {
  device: DeviceRow;
  eventRows: EventRow[];
}) => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        Charts and stats
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Operational trends for {device.name}</CardTitle>
    </CardHeader>
    <CardContent className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-[28px] border border-border/70 bg-background/55 p-5">
        <div className="flex h-72 items-end gap-3">
          {[42, 58, 31, 66, 44, 72, 54].map((value, index) => (
            <div key={`${value}-${index}`} className="flex-1 rounded-t-2xl bg-primary/16">
              <div
                className="rounded-t-2xl bg-primary"
                style={{ height: `${value}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Total recorded events
          </p>
          <p className="mt-2 text-sm text-foreground">{eventRows.length}</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Device status
          </p>
          <p className="mt-2 text-sm text-foreground">{device.status ?? 'unknown'}</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Chart host
          </p>
          <p className="mt-2 text-sm text-foreground">
            The dashboard can grow into charts, operator stats, and SLA views without route churn.
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const DeviceRuntimePanel = ({ device }: { device: DeviceRow }) => {
  const runtimeServices = [
    ['runtime-manager', 'Coordinates managed services and health.'],
    ['ai-inference', 'Dedicated model inference runtime.'],
    ['workflow-engine', 'Consumes Redis frame envelopes and executes workflow nodes.'],
    ['cloud-comm', 'MQTT metadata lane toward the cloud.'],
    ['transfer-manager', 'Signed URL uploads, retries, and durable transfer queue.'],
    ['audio-alert', 'Speaker alerts and future talkback bridge.'],
  ];

  return (
    <Card className="border-primary/10 bg-card/85">
      <CardHeader className="border-b border-border/70">
        <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
          Runtime panel
        </CardDescription>
        <CardTitle className="text-xl text-foreground">Device services and control plane</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runtimeServices.map(([serviceName, summary]) => (
            <div key={serviceName} className="rounded-2xl border border-border/70 bg-background/55 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.68rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    {serviceName}
                  </p>
                  <p className="mt-2 text-sm text-foreground">
                    {device.status === 'active' ? 'Reachability check next' : 'Pending activation'}
                  </p>
                </div>
                <Activity className="size-4 text-primary/80" />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{summary}</p>
            </div>
          ))}
        </div>
        <div className={fieldClassName}>
          This is where the cloud-hosted equivalent of the existing edge control surface can live.
          The route and panel host are ready; the next backend step is feeding real runtime-manager
          and service telemetry into it.
        </div>
      </CardContent>
    </Card>
  );
};

const DeviceWorkspacePage = ({ deviceId }: { deviceId: string }) => {
  const searchParams = useSearchParams();
  const bootstrapQuery = api.admin.bootstrapStatus.useQuery();
  const isAdmin = bootstrapQuery.data?.isAdmin ?? false;
  const devicesQuery = api.devices.list.useQuery(undefined, { enabled: isAdmin });
  const eventsQuery = api.events.summary.useQuery(undefined, { enabled: isAdmin });

  if (bootstrapQuery.isLoading || (isAdmin && devicesQuery.isLoading)) {
    return <LoadingState label="device workspace" />;
  }

  if (!isAdmin) {
    return (
      <PageFrame
        eyebrow="Device workspace"
        summary="The route host is ready, but this specific detail surface still needs user-scoped device lookup data."
        title="Scoped device page pending"
      >
        <EmptyState
          actionHref="/devices"
          actionLabel="Back to devices"
          description="This device workspace is wired for live feed, PTZ, workflows, events, analytics, and runtime tabs. The missing piece is a backend endpoint that resolves a non-admin user's allowed devices."
          title="User-scoped device detail needs backend support"
        />
      </PageFrame>
    );
  }

  const device = (devicesQuery.data?.devices ?? []).find((entry) => entry.id === deviceId);
  const panelParam = searchParams.get('panel');
  const activePanel = devicePanels.some((panel) => panel.key === panelParam)
    ? (panelParam as DevicePanelKey)
    : 'live';

  if (!device) {
    return (
      <PageFrame
        eyebrow="Device workspace"
        summary="The selected route did not match a device in the current fleet snapshot."
        title="Device not found"
      >
        <EmptyState
          actionHref="/devices"
          actionLabel="Return to device directory"
          description="The device may have been removed, or the route may have been opened before the current fleet snapshot loaded."
          title="This workspace no longer has a backing device"
        />
      </PageFrame>
    );
  }

  const eventRows =
    (eventsQuery.data?.recentEvents ?? []).filter(
      (row) => row.devicePublicId === device.publicId,
    ) ?? [];

  const activePanelDefinition =
    devicePanels.find((panel) => panel.key === activePanel) ?? devicePanels[0];

  let panelContent: ReactNode = <DeviceLivePanel device={device} />;

  if (activePanel === 'ptz') {
    panelContent = <DevicePTZPanel />;
  } else if (activePanel === 'workflow') {
    panelContent = <DeviceWorkflowPanel />;
  } else if (activePanel === 'violations') {
    panelContent = (
      <DeviceEventsPanel
        device={device}
        label="Violation viewer"
        rows={eventRows.filter((row) => row.type === 'violation')}
      />
    );
  } else if (activePanel === 'tilt') {
    panelContent = (
      <DeviceEventsPanel
        device={device}
        label="Tilt viewer"
        rows={eventRows.filter((row) => row.type === 'tilt')}
      />
    );
  } else if (activePanel === 'analytics') {
    panelContent = <DeviceAnalyticsPanel device={device} eventRows={eventRows} />;
  } else if (activePanel === 'runtime') {
    panelContent = <DeviceRuntimePanel device={device} />;
  }

  return (
    <PageFrame
      eyebrow="Device detail"
      summary="Each device gets a dedicated workspace route with stable tabs for the app surfaces operators will use most."
      title={device.name}
    >
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card className="border-primary/10 bg-card/82">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                  {device.publicId}
                </CardDescription>
                <CardTitle className="text-2xl text-foreground">{device.name}</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-sm leading-relaxed">
                  {device.description ?? 'This device workspace is ready to host operator panels.'}
                </CardDescription>
              </div>
              <span
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase',
                  statusTone(device.status),
                )}
              >
                {device.status ?? 'unknown'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  Placement
                </p>
                <p className="mt-2 text-sm text-foreground">{device.headquarterName ?? 'Unassigned'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {device.factoryName ?? 'Unassigned'} / {device.departmentName ?? 'Unassigned'}
                </p>
              </div>
              <div className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  Last seen
                </p>
                <p className="mt-2 text-sm text-foreground">{formatDate(device.lastSeenAt)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatRelative(device.lastSeenAt)}</p>
              </div>
              <div className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  Active tab
                </p>
                <p className="mt-2 text-sm text-foreground">{activePanelDefinition.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activePanelDefinition.description}
                </p>
              </div>
            </div>
            <DevicePanelTabs activePanel={activePanel} deviceId={device.id} />
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Panel policy
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Supported app surfaces</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {devicePanels.map((panel) => {
              const Icon = panel.icon;
              return (
                <div key={panel.key} className="rounded-2xl border border-border/70 bg-background/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl border border-primary/20 bg-primary/10 p-2">
                        <Icon className="size-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{panel.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {panel.description}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase',
                        metricClasses[panel.tone],
                      )}
                    >
                      {panel.tone === 'active' ? 'ready host' : 'next implementation'}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className={fieldClassName}>
              This right rail is where admins can later wire app availability and per-user panel
              grants once the ACL management endpoints are in place.
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div>{panelContent}</div>

        <div className="space-y-4">
          <Card className="border-primary/10 bg-card/80">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Control posture
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Admin view of this device</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className={fieldClassName}>
                Admins can reach runtime status, service posture, and supported panel inventory
                from the same device route users will use for day-to-day operations.
              </div>
              <div className={fieldClassName}>
                Higher-level access policy still needs dedicated ACL editing screens, but the
                workspace is already shaped around device app visibility as the governing concept.
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/80">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Quick jumps
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Related surfaces</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                <Link href="/devices">Back to device directory</Link>
              </Button>
              <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                <Link href="/apps">Review app catalog</Link>
              </Button>
              <Button asChild className="w-full justify-between border border-border/80 bg-background/70 text-foreground" variant="outline">
                <Link href="/events">Open event operations</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </PageFrame>
  );
};

export { DashboardWorkspacePage, DeviceDirectoryPage, DeviceWorkspacePage };
