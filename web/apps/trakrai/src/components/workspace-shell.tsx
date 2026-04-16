'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';

import { Button } from '@trakrai/design-system/components/button';
import { Card, CardContent } from '@trakrai/design-system/components/card';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  Blocks,
  Building2,
  ChevronRight,
  LayoutDashboard,
  MonitorCog,
  MoonStar,
  Radar,
  ShieldCheck,
  SunMedium,
  Workflow,
} from 'lucide-react';

import { api } from '@/server/react';

import type { RouterOutput } from '@/server/routers';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type WorkspaceDevice = RouterOutput['devices']['list']['devices'][number];

type DeviceTreeDepartment = {
  devices: WorkspaceDevice[];
  id: string;
  name: string;
};

type DeviceTreeFactory = {
  departments: DeviceTreeDepartment[];
  id: string;
  name: string;
};

type DeviceTreeHeadquarter = {
  factories: DeviceTreeFactory[];
  id: string;
  name: string;
};

type WorkspaceNavigationItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
};

const workspaceNavigation: WorkspaceNavigationItem[] = [
  {
    description: 'Signed-in summary, posture, and onboarding progress.',
    href: '/',
    icon: LayoutDashboard,
    label: 'Dashboard',
  },
  {
    description: 'Browse the accessible fleet and open device workspaces.',
    href: '/devices',
    icon: MonitorCog,
    label: 'Devices',
  },
];

const adminNavigation: WorkspaceNavigationItem[] = [
  {
    description: 'Headquarters, factories, departments, and placement.',
    href: '/hierarchy',
    icon: Building2,
    label: 'Hierarchy',
  },
  {
    description: 'User roster, scoped access, and delegation.',
    href: '/users',
    icon: ShieldCheck,
    label: 'Users',
  },
  {
    description: 'Application catalog and device panel availability.',
    href: '/apps',
    icon: Blocks,
    label: 'Apps',
  },
  {
    description: 'Cloud and edge workflow posture.',
    href: '/workflows',
    icon: Workflow,
    label: 'Workflows',
  },
  {
    description: 'Violation, tilt, and file-transfer operations.',
    href: '/events',
    icon: Radar,
    label: 'Events',
  },
];

const pageTitles: Record<string, { title: string; summary: string }> = {
  '/': {
    summary: 'Start from the signed-in dashboard, then move straight into devices or admin operations.',
    title: 'Workspace Dashboard',
  },
  '/apps': {
    summary: 'Control which cloud and device panels exist, and which ones can be granted.',
    title: 'App Catalog',
  },
  '/devices': {
    summary: 'Use the hierarchy rail to move across the fleet and open device-specific workspaces.',
    title: 'Device Workspace',
  },
  '/events': {
    summary: 'Review edge-originated events, ingestion status, and delivery posture.',
    title: 'Event Operations',
  },
  '/hierarchy': {
    summary: 'Model the business tree that every device, user, and permission scope hangs from.',
    title: 'Hierarchy Control',
  },
  '/users': {
    summary: 'Manage admins, operators, and future mixed-scope access lanes.',
    title: 'User Access',
  },
  '/workflows': {
    summary: 'Track the cloud and device workflow systems without collapsing them together.',
    title: 'Workflow Systems',
  },
};

const statusClasses = {
  active:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  idle: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
};

const isActivePath = (pathname: string, href: string) => {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

const buildDeviceTree = (devices: WorkspaceDevice[]) => {
  const headquarterMap = new Map<
    string,
    {
      factories: Map<
        string,
        {
          departments: Map<string, DeviceTreeDepartment>;
          id: string;
          name: string;
        }
      >;
      id: string;
      name: string;
    }
  >();

  for (const entry of devices) {
    const headquarterId = entry.headquarterId ?? 'unassigned-headquarter';
    const factoryId = entry.factoryId ?? `unassigned-factory-${headquarterId}`;
    const departmentId = entry.departmentId ?? `unassigned-department-${factoryId}`;

    const headquarterRecord =
      headquarterMap.get(headquarterId) ??
      {
        factories: new Map(),
        id: headquarterId,
        name: entry.headquarterName ?? 'Unassigned headquarter',
      };

    const factoryRecord =
      headquarterRecord.factories.get(factoryId) ??
      {
        departments: new Map(),
        id: factoryId,
        name: entry.factoryName ?? 'Unassigned factory',
      };

    const departmentRecord =
      factoryRecord.departments.get(departmentId) ??
      {
        devices: [],
        id: departmentId,
        name: entry.departmentName ?? 'Unassigned department',
      };

    departmentRecord.devices.push(entry);
    factoryRecord.departments.set(departmentId, departmentRecord);
    headquarterRecord.factories.set(factoryId, factoryRecord);
    headquarterMap.set(headquarterId, headquarterRecord);
  }

  return Array.from(headquarterMap.values()).map<DeviceTreeHeadquarter>((headquarter) => ({
    factories: Array.from(headquarter.factories.values()).map<DeviceTreeFactory>((factory) => ({
      departments: Array.from(factory.departments.values()),
      id: factory.id,
      name: factory.name,
    })),
    id: headquarter.id,
    name: headquarter.name,
  }));
};

const formatPathTitle = (pathname: string) => {
  if (pathname.startsWith('/devices/')) {
    return {
      summary: 'Switch device app tabs in the main canvas while keeping the fleet tree in view.',
      title: 'Device Detail',
    };
  }

  return pageTitles[pathname] ?? pageTitles['/'];
};

const WorkspaceThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <Button
      aria-label="Toggle theme"
      className="border border-border/80 bg-background/70 text-foreground backdrop-blur"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      type="button"
      variant="outline"
    >
      {isDark ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
      <span className="ml-2 hidden sm:inline">{isDark ? 'Light mode' : 'Dark mode'}</span>
    </Button>
  );
};

const NavigationLink = ({
  active,
  item,
}: {
  active: boolean;
  item: WorkspaceNavigationItem;
}) => {
  const Icon = item.icon;

  return (
    <Link
      className={cn(
        'group flex flex-col gap-1 rounded-2xl border px-4 py-3 transition-colors',
        active
          ? 'border-primary/40 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(247,197,60,0.08)]'
          : 'border-border/70 bg-card/65 text-muted-foreground hover:border-primary/25 hover:bg-card hover:text-foreground',
      )}
      href={item.href}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4', active ? 'text-primary' : 'text-primary/70')} />
        <span className="text-[0.68rem] font-semibold tracking-[0.24em] uppercase">
          {item.label}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-inherit/80">{item.description}</p>
    </Link>
  );
};

const DeviceRail = ({
  devices,
  isAdmin,
  loading,
  pathname,
}: {
  devices: WorkspaceDevice[];
  isAdmin: boolean;
  loading: boolean;
  pathname: string;
}) => {
  if (!isAdmin) {
    return (
      <Card className="border-border/70 bg-card/70">
        <CardContent className="space-y-3 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Your assigned devices will appear here.</p>
          <p>
            This shell is ready for scoped device trees, but the user-scoped device access queries
            still need to be wired on the backend.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="border-border/70 bg-card/70">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading fleet tree...</CardContent>
      </Card>
    );
  }

  if (devices.length === 0) {
    return (
      <Card className="border-border/70 bg-card/70">
        <CardContent className="space-y-3 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No devices are registered yet.</p>
          <p>
            Once a device is provisioned, it will appear in this hierarchy so operators can open
            its workspace directly.
          </p>
          <Button asChild className="w-full" variant="outline">
            <Link href="/devices">Open device setup</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tree = buildDeviceTree(devices);

  return (
    <div className="space-y-4">
      {tree.map((headquarter) => (
        <div key={headquarter.id} className="space-y-3 rounded-2xl border border-border/70 bg-card/70 p-4">
          <div>
            <p className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Headquarter
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">{headquarter.name}</p>
          </div>
          <div className="space-y-3">
            {headquarter.factories.map((factory) => (
              <div key={factory.id} className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="size-3.5 text-primary/80" />
                  <span className="font-medium text-foreground">{factory.name}</span>
                </div>
                <div className="space-y-2 border-l border-border/70 pl-3">
                  {factory.departments.map((department) => (
                    <div key={department.id} className="space-y-2">
                      <div className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {department.name}
                      </div>
                      <div className="space-y-2">
                        {department.devices.map((device) => {
                          const active = pathname.startsWith(`/devices/${device.id}`);

                          return (
                            <Link
                              key={device.id}
                              className={cn(
                                'flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors',
                                active
                                  ? 'border-primary/40 bg-primary/12 text-foreground'
                                  : 'border-border/60 bg-background/55 text-muted-foreground hover:border-primary/25 hover:text-foreground',
                              )}
                              href={`/devices/${device.id}`}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{device.name}</p>
                                <p className="truncate text-xs text-inherit/75">{device.publicId}</p>
                              </div>
                              <ChevronRight className="size-4 shrink-0 text-primary/80" />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const WorkspaceShell = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const bootstrapQuery = api.admin.bootstrapStatus.useQuery();
  const healthQuery = api.health.useQuery();
  const isAdmin = bootstrapQuery.data?.isAdmin ?? false;
  const devicesQuery = api.devices.list.useQuery(undefined, {
    enabled: isAdmin,
  });

  const page = formatPathTitle(pathname);
  const displayName =
    bootstrapQuery.data?.user.name ??
    bootstrapQuery.data?.user.email ??
    'TrakrAI operator';

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(247,197,60,0.12),transparent_28%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background))_35%,color-mix(in_oklab,hsl(var(--background))_84%,black)_100%)] text-foreground transition-colors">
      <div className="pointer-events-none fixed inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,214,82,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,214,82,0.18)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 py-4 lg:flex-row lg:gap-6 lg:px-6 lg:py-6">
        <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-[330px] lg:self-start lg:overflow-y-auto">
          <Card className="overflow-hidden border-primary/20 bg-card/85 shadow-[0_24px_80px_-48px_rgba(247,197,60,0.45)]">
            <CardContent className="space-y-5 p-5">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.65rem] font-semibold tracking-[0.32em] text-primary uppercase">
                      TrakrAI cloud
                    </p>
                    <h1
                      className="mt-2 text-2xl text-foreground"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      Workspace
                    </h1>
                  </div>
                  <WorkspaceThemeToggle />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Device-first operator workspace for onboarding, monitoring, and switching into
                  the right app surface without falling back to the legacy ThingsBoard model.
                </p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
                <p className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                  Signed in as
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">{displayName}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase',
                      isAdmin ? statusClasses.active : statusClasses.idle,
                    )}
                  >
                    {isAdmin ? 'Site admin' : 'Workspace user'}
                  </span>
                  <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                    {healthQuery.data?.status === 'ok' ? 'Cloud healthy' : 'Checking health'}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {workspaceNavigation.map((item) => (
                  <NavigationLink
                    key={item.href}
                    active={isActivePath(pathname, item.href)}
                    item={item}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[0.68rem] font-semibold tracking-[0.24em] text-primary uppercase">
                  Fleet hierarchy
                </p>
                <p className="text-sm text-muted-foreground">Pick a device and open its workspace.</p>
              </div>
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                {isAdmin ? `${devicesQuery.data?.devices.length ?? 0} devices` : 'Scoped'}
              </span>
            </div>
            <DeviceRail
              devices={devicesQuery.data?.devices ?? []}
              isAdmin={isAdmin}
              loading={bootstrapQuery.isLoading || devicesQuery.isLoading}
              pathname={pathname}
            />
          </section>

          {isAdmin ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[0.68rem] font-semibold tracking-[0.24em] text-primary uppercase">
                    Admin lanes
                  </p>
                  <p className="text-sm text-muted-foreground">Jump into management surfaces.</p>
                </div>
                <ShieldCheck className="size-4 text-primary" />
              </div>
              <div className="space-y-3">
                {adminNavigation.map((item) => (
                  <NavigationLink
                    key={item.href}
                    active={isActivePath(pathname, item.href)}
                    item={item}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <header className="rounded-[28px] border border-border/70 bg-card/82 p-5 shadow-[0_20px_80px_-56px_rgba(15,23,42,0.6)] backdrop-blur">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Signed-in workspace
                  </span>
                  {pathname.startsWith('/devices/') ? (
                    <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                      Device detail
                    </span>
                  ) : null}
                </div>
                <div>
                  <h2
                    className="text-3xl text-foreground sm:text-4xl"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {page.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {page.summary}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild className="border border-primary/35 bg-primary text-primary-foreground">
                  <Link href="/devices">Open devices</Link>
                </Button>
                {isAdmin ? (
                  <Button asChild className="border border-border/80 bg-background/70 text-foreground" variant="outline">
                    <Link href="/hierarchy">Site admin</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                Dashboard first
              </span>
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                Device-centric navigation
              </span>
              <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.62rem] font-semibold tracking-[0.18em] uppercase text-muted-foreground">
                Admin controls layered on top
              </span>
            </div>
          </header>

          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
};

export { WorkspaceShell };
