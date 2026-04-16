'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  ArrowRight,
  Blocks,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  TowerControl,
} from 'lucide-react';

import { SessionActions } from '@/components/session-actions';
import { api } from '@/server/react';

import type { ReactNode } from 'react';

const routeIconMap = {
  '/dashboard': LayoutDashboard,
  '/events': Radar,
  '/live': TowerControl,
  '/workflows': Blocks,
} as const;

const isActivePath = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export const AppShell = ({
  children,
  sessionUser,
}: {
  children: ReactNode;
  sessionUser: {
    email: string;
    name: string;
    role: string | null;
  };
}) => {
  const pathname = usePathname();
  const bootstrapQuery = api.access.bootstrap.useQuery();
  const bootstrap = bootstrapQuery.data;

  const primaryRoutes = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/devices', label: 'Devices' },
  ];

  const additionalRoutes =
    bootstrap?.visibleCloudApps
      .map((app) => {
        const route = typeof app.metadata?.route === 'string' ? app.metadata.route : null;
        if (!route || route === '/dashboard' || route === '/admin') {
          return null;
        }

        return {
          href: route,
          label: app.name,
        };
      })
      .filter((entry): entry is { href: string; label: string } => entry !== null) ?? [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,197,24,0.12),transparent_24%),linear-gradient(180deg,rgba(245,197,24,0.05),transparent_20%)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 pb-8 pt-24 sm:px-6 lg:px-8">
        <header className="rounded-[28px] border border-border/60 bg-background/90 px-5 py-5 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.45)] backdrop-blur xl:px-7">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/10 text-sm font-semibold uppercase tracking-[0.28em] text-amber-500 dark:text-amber-300">
                    T
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-600 dark:text-amber-300">
                      TrakrAI Cloud
                    </p>
                    <h1 className="font-[var(--font-display)] text-3xl leading-none text-balance sm:text-4xl">
                      Unified safety operations
                    </h1>
                  </div>
                </div>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  One signed-in workspace for hierarchy-aware access, device operations, workflow
                  rollout, violation review, and runtime supervision.
                </p>
              </div>

              <div className="flex flex-col gap-3 xl:items-end">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{sessionUser.name}</span>
                    {' · '}
                    {sessionUser.email}
                  </div>
                  {bootstrap?.routes.admin ? (
                    <Button
                      asChild
                      className="rounded-full border border-amber-400/70 bg-amber-400 text-stone-950 hover:bg-amber-300"
                    >
                      <Link href={bootstrap.routes.admin}>
                        <ShieldCheck className="size-4" />
                        Site Admin
                      </Link>
                    </Button>
                  ) : null}
                  <SessionActions />
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Accessible devices: {bootstrap?.summary.accessibleDevices ?? '...'}
                  </div>
                  <div className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Manageable scopes: {bootstrap?.summary.manageableScopes ?? '...'}
                  </div>
                  <div className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Role: {bootstrap?.user.role ?? sessionUser.role ?? 'user'}
                  </div>
                </div>
              </div>
            </div>

            <nav aria-label="Primary" className="flex flex-wrap gap-2">
              {primaryRoutes.concat(additionalRoutes).map((route) => {
                const Icon = routeIconMap[route.href as keyof typeof routeIconMap] ?? ArrowRight;
                const active = isActivePath(pathname, route.href);

                return (
                  <Link
                    key={route.href}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
                      active
                        ? 'border-amber-400/70 bg-amber-400/15 text-foreground'
                        : 'border-border/70 bg-background/80 text-muted-foreground hover:border-amber-400/40 hover:text-foreground',
                    )}
                    href={route.href}
                  >
                    <Icon className="size-4" />
                    {route.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        <main className="mt-6 flex-1">{children}</main>
      </div>
    </div>
  );
};
