'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  ActivitySquare,
  AppWindow,
  Blocks,
  Building2,
  Cable,
  MonitorCog,
  Radar,
  ShieldCheck,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type ConsoleNavigationItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
};

const consoleNavigation: ConsoleNavigationItem[] = [
  {
    description: 'Command posture, active queues, and fleet health.',
    href: '/',
    icon: ActivitySquare,
    label: 'Overview',
  },
  {
    description: 'Headquarters, factories, departments, and scopes.',
    href: '/hierarchy',
    icon: Building2,
    label: 'Hierarchy',
  },
  {
    description: 'Operators, admins, and delegated access lanes.',
    href: '/users',
    icon: ShieldCheck,
    label: 'Users',
  },
  {
    description: 'Registration, tokens, and deployment readiness.',
    href: '/devices',
    icon: MonitorCog,
    label: 'Devices',
  },
  {
    description: 'App entitlements and operator-console availability.',
    href: '/apps',
    icon: AppWindow,
    label: 'Apps',
  },
  {
    description: 'Cloud workflows, edge workflow packs, schema drift.',
    href: '/workflows',
    icon: Blocks,
    label: 'Workflows',
  },
  {
    description: 'Violation and tilt event lanes, retries, and handoff.',
    href: '/events',
    icon: Radar,
    label: 'Events',
  },
];

const consoleSignals = [
  {
    label: 'Bridge',
    tone: 'nominal' as const,
    value: 'Live gateway shared',
  },
  {
    label: 'Admin plane',
    tone: 'warning' as const,
    value: 'Shell preview',
  },
  {
    label: 'Routing',
    tone: 'nominal' as const,
    value: 'Thin MQTT gateway',
  },
];

const signalClasses = {
  nominal: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warning: 'border-primary/30 bg-primary/10 text-primary',
};

const isActivePath = (pathname: string, href: string) => {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

const AdminShell = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();

  return (
    <div
      className="dark min-h-screen bg-[radial-gradient(circle_at_top,rgba(247,197,60,0.12),transparent_28%),linear-gradient(180deg,#0b0d0f_0%,#111315_32%,#090a0b_100%)] text-foreground"
      style={{ ['--font-heading' as string]: 'var(--font-display)' }}
    >
      <div className="pointer-events-none fixed inset-0 opacity-25 [background-image:linear-gradient(rgba(255,214,82,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,214,82,0.06)_1px,transparent_1px)] [background-size:72px_72px]" />
      <header className="sticky top-0 z-50 border-b border-primary/15 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/12 text-primary">
                  <Cable className="size-4" />
                </div>
                <div>
                  <p className="text-[0.65rem] font-semibold tracking-[0.32em] text-primary uppercase">
                    TrakrAI Cloud
                  </p>
                  <h1
                    className="text-2xl text-foreground sm:text-3xl"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    Admin Command Grid
                  </h1>
                </div>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                First-pass operator shell for the rebuilt cloud app. The structure mirrors the
                future admin plane: scoped access, device fleet management, workflow operations,
                and event intake without carrying over the old ThingsBoard assumptions.
              </p>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap gap-2">
                {consoleSignals.map((signal) => (
                  <div
                    key={signal.label}
                    className={cn(
                      'flex items-center gap-2 border px-3 py-2 text-[0.68rem] font-medium tracking-[0.22em] uppercase',
                      signalClasses[signal.tone],
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>{signal.label}</span>
                    <span className="text-[0.6rem] tracking-[0.16em] text-current/80">
                      {signal.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="border border-primary/40 bg-primary text-primary-foreground">
                  <Link href="/live">Open live workspace</Link>
                </Button>
                <Button
                  asChild
                  className="border border-border bg-transparent text-foreground"
                  variant="outline"
                >
                  <Link href="/auth/login">Auth portal</Link>
                </Button>
              </div>
            </div>
          </div>

          <nav aria-label="Primary" className="no-scrollbar overflow-x-auto">
            <div className="flex min-w-max gap-2 pb-1">
              {consoleNavigation.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    className={cn(
                      'group flex min-w-[190px] flex-col gap-1 border px-3 py-3 transition-colors',
                      active
                        ? 'border-primary bg-primary/12 text-foreground'
                        : 'border-border/80 bg-card/70 text-muted-foreground hover:border-primary/30 hover:bg-card hover:text-foreground',
                    )}
                    href={item.href}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn('size-4', active ? 'text-primary' : 'text-primary/70')} />
                      <span className="text-[0.7rem] font-semibold tracking-[0.26em] uppercase">
                        {item.label}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-inherit/80">{item.description}</p>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
    </div>
  );
};

export { AdminShell };
