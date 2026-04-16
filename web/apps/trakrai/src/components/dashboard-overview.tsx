'use client';

import Link from 'next/link';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { ArrowRight, Building2, MonitorCog, ShieldCheck, Sparkles } from 'lucide-react';

import { api } from '@/server/react';

const StatCard = ({
  description,
  label,
  value,
}: {
  description: string;
  label: string;
  value: string | number;
}) => (
  <Card className="border-border/70 bg-background/85">
    <CardHeader className="border-b border-border/60">
      <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
        {label}
      </CardDescription>
      <CardTitle className="text-3xl">{value}</CardTitle>
    </CardHeader>
    <CardContent className="pt-4 text-sm leading-6 text-muted-foreground">{description}</CardContent>
  </Card>
);

export const DashboardOverview = () => {
  const bootstrapQuery = api.access.bootstrap.useQuery();
  const deviceTreeQuery = api.access.deviceTree.useQuery();

  if (bootstrapQuery.isLoading || deviceTreeQuery.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border-border/60 bg-background/85">
            <CardHeader className="border-b border-border/60">
              <CardDescription>Loading</CardDescription>
              <CardTitle className="text-2xl">...</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (bootstrapQuery.error || deviceTreeQuery.error || !bootstrapQuery.data || !deviceTreeQuery.data) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/10">
        <CardHeader>
          <CardTitle className="text-rose-50">Unable to load dashboard</CardTitle>
          <CardDescription className="text-rose-100/85">
            {bootstrapQuery.error?.message ?? deviceTreeQuery.error?.message ?? 'Unknown error'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const bootstrap = bootstrapQuery.data;
  const tree = deviceTreeQuery.data;
  const firstDevice =
    tree.tree[0]?.factories[0]?.departments[0]?.devices[0] ?? tree.unassignedDevices[0] ?? null;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          description="Devices available inside your current access boundary."
          label="Accessible devices"
          value={bootstrap.summary.accessibleDevices}
        />
        <StatCard
          description="Scopes you can actively manage through the hierarchy-aware access model."
          label="Manageable scopes"
          value={bootstrap.summary.manageableScopes}
        />
        <StatCard
          description="Cloud surfaces currently visible to this user."
          label="Visible apps"
          value={bootstrap.visibleCloudApps.length}
        />
        <StatCard
          description="Hierarchy nodes represented in your current device tree."
          label="Sites in tree"
          value={tree.counts.headquarters + tree.counts.factories + tree.counts.departments}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/70 bg-background/88">
          <CardHeader className="border-b border-border/60">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
              Workspace summary
            </CardDescription>
            <CardTitle className="text-3xl">Your operating surface is ready</CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">
              The new cloud app is now structured around scoped access first: dashboard for summary,
              devices for day-to-day operation, and admin controls only where the current account
              is allowed to manage hierarchy, users, panels, or services.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
            <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5">
              <div className="flex items-center gap-3">
                <MonitorCog className="size-5 text-amber-600 dark:text-amber-300" />
                <h3 className="text-lg font-medium">Devices</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Open the device workspace to browse the accessible hierarchy, pick a device, and
                switch between live feed, PTZ, violations, tilt, charts, stats, workflow, and
                runtime surfaces.
              </p>
              <Button asChild className="mt-4 rounded-full">
                <Link href={firstDevice ? `/devices?deviceId=${firstDevice.id}` : '/devices'}>
                  Open devices
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5">
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-5 text-amber-600 dark:text-amber-300" />
                <h3 className="text-lg font-medium">Access control</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Manage membership scopes and device-app visibility per user without hardcoding app
                semantics into the services that forward or process data.
              </p>
              {bootstrap.routes.admin ? (
                <Button asChild className="mt-4 rounded-full" variant="outline">
                  <Link href={`${bootstrap.routes.admin}/users`}>
                    Open user management
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-background/88">
          <CardHeader className="border-b border-border/60">
            <CardDescription className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-600 dark:text-amber-300">
              Visible cloud apps
            </CardDescription>
            <CardTitle className="text-2xl">Routes for this account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {bootstrap.visibleCloudApps.map((app) => {
              const route = typeof app.metadata.route === 'string' ? app.metadata.route : null;
              const Icon =
                route === '/dashboard' ? Sparkles : route === '/admin' ? ShieldCheck : Building2;

              return (
                <Link
                  key={app.id}
                  className="flex items-center justify-between rounded-[20px] border border-border/70 bg-muted/30 px-4 py-4 transition-colors hover:border-amber-400/40 hover:bg-muted/50"
                  href={route ?? '/dashboard'}
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 text-amber-600 dark:text-amber-300" />
                      {app.name}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {app.reason === 'system-admin'
                        ? 'Visible because this account is a system administrator.'
                        : 'Visible within the current scope and app policy.'}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
};
