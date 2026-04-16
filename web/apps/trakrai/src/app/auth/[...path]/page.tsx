import { type ReactNode } from 'react';

import Link from 'next/link';

import {
  ArrowRight,
  AudioLines,
  ShieldCheck,
  SlidersHorizontal,
  Waypoints,
} from 'lucide-react';

import { ForgotPasswordForm, LoginForm, RegisterForm, ResetPasswordForm } from './components';

const authViews: Record<
  string,
  {
    Component: () => ReactNode;
    description: string;
    eyebrow: string;
    heroBody: string;
    heroTitle: string;
    kicker: string;
    title: string;
  }
> = {
  login: {
    Component: LoginForm,
    title: 'Enter the operating dashboard',
    description: 'Sign in to manage fleets, safety workflows, device apps, and role-based access.',
    eyebrow: 'Cloud + Edge Safety Ops',
    kicker: 'Existing team access',
    heroTitle: 'One control surface for every device, rule, and operator.',
    heroBody:
      'TrakrAI Cloud brings the workflow designer, live monitoring, PTZ control, violations, and system health into a single admin-first workspace.',
  },
  register: {
    Component: RegisterForm,
    title: 'Create your cloud operator account',
    description: 'Start onboarding your organization, then connect sites, teams, and devices into the shared dashboard.',
    eyebrow: 'Platform Onboarding',
    kicker: 'New deployment setup',
    heroTitle: 'Launch a modern safety operations stack without the legacy platform baggage.',
    heroBody:
      'Provision the first administrator, shape your hierarchy, and turn devices into app-enabled workspaces for every department that needs visibility.',
  },
  'forgot-password': {
    Component: ForgotPasswordForm,
    title: 'Request a secure reset link',
    description: 'We will send you a reset link so you can get back into the dashboard without involving another admin.',
    eyebrow: 'Account Recovery',
    kicker: 'Secure password reset',
    heroTitle: 'Keep access resilient, even when credentials change hands.',
    heroBody:
      'Recovery flows stay lightweight for operators while still fitting into an enterprise-ready identity and permissions model.',
  },
  'reset-password': {
    Component: ResetPasswordForm,
    title: 'Set your new password',
    description: 'Choose a fresh password and return directly to your TrakrAI workspace.',
    eyebrow: 'Recovery Complete',
    kicker: 'Finalize access',
    heroTitle: 'Restore access and get back to the dashboard in a single step.',
    heroBody:
      'Once the password is updated, the same cloud workspace remains available for device operations, incident review, and policy management.',
  },
  'sign-in': {
    Component: LoginForm,
    title: 'Enter the operating dashboard',
    description: 'Sign in to manage fleets, safety workflows, device apps, and role-based access.',
    eyebrow: 'Cloud + Edge Safety Ops',
    kicker: 'Existing team access',
    heroTitle: 'One control surface for every device, rule, and operator.',
    heroBody:
      'TrakrAI Cloud brings the workflow designer, live monitoring, PTZ control, violations, and system health into a single admin-first workspace.',
  },
  'sign-up': {
    Component: RegisterForm,
    title: 'Create your cloud operator account',
    description: 'Start onboarding your organization, then connect sites, teams, and devices into the shared dashboard.',
    eyebrow: 'Platform Onboarding',
    kicker: 'New deployment setup',
    heroTitle: 'Launch a modern safety operations stack without the legacy platform baggage.',
    heroBody:
      'Provision the first administrator, shape your hierarchy, and turn devices into app-enabled workspaces for every department that needs visibility.',
  },
};

const heroStats = [
  { label: 'Device Apps', value: '06' },
  { label: 'Hierarchy Layers', value: '04' },
  { label: 'Access Modes', value: 'ACL / RBAC / ABAC' },
];

const heroModules = [
  {
    icon: Waypoints,
    title: 'Workflow-native operations',
    body: 'Move detections from edge inference into cloud workflows without burying business logic inside transport layers.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Admin-controlled device apps',
    body: 'Decide who can view live feed, PTZ, violations, tilt insights, workflow design, or runtime service panels per device.',
  },
  {
    icon: AudioLines,
    title: 'Real-time intervention',
    body: 'Pair live monitoring with alerts, talkback, evidence uploads, and future app modules without redesigning the UI shell.',
  },
  {
    icon: ShieldCheck,
    title: 'Scoped team access',
    body: 'Grant read, operate, or manage capabilities at headquarters, factory, department, and device levels from one console.',
  },
];

export default async function Page(props: Readonly<PageProps<'/auth/[...path]'>>) {
  const { path } = await props.params;
  const currentPath = path[0] ?? 'sign-in';
  const authView = authViews[currentPath];

  if (authView === undefined) {
    return null;
  }

  const AuthComponent = authView.Component;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(245,197,24,0.12),transparent_32%),linear-gradient(180deg,rgba(245,197,24,0.04),transparent_28%)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />

      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden lg:flex">
          <div className="absolute inset-0 bg-[#17120c]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,197,24,0.22),transparent_36%),linear-gradient(145deg,rgba(255,255,255,0.03),transparent_42%)]" />
          <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col justify-between px-10 py-12 text-stone-50 [font-family:var(--font-brand)] xl:px-14">
            <div className="space-y-8">
              <div className="flex items-center justify-between gap-4">
                <Link className="inline-flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-stone-300/80" href="/auth/sign-in">
                  <span className="inline-flex size-11 items-center justify-center border border-amber-400/45 bg-amber-400/10 text-lg text-amber-300">
                    T
                  </span>
                  TrakrAI Cloud
                </Link>
                <span className="border border-stone-700/80 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-stone-300/70">
                  {authView.kicker}
                </span>
              </div>

              <div className="space-y-5">
                <p className="text-[11px] uppercase tracking-[0.36em] text-amber-300/90">
                  {authView.eyebrow}
                </p>
                <h1 className="max-w-2xl font-[var(--font-display)] text-5xl leading-[0.98] text-balance xl:text-6xl">
                  {authView.heroTitle}
                </h1>
                <p className="max-w-xl text-base leading-7 text-stone-300/78">
                  {authView.heroBody}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {heroStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="border border-stone-700/80 bg-stone-950/35 px-5 py-4"
                  >
                    <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">
                      {stat.label}
                    </p>
                    <p className="mt-3 text-2xl text-stone-50">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {heroModules.map((module) => {
                const Icon = module.icon;

                return (
                  <div
                    key={module.title}
                    className="border border-stone-700/80 bg-stone-950/40 p-5"
                  >
                    <Icon className="size-5 text-amber-300" />
                    <h2 className="mt-6 text-lg text-stone-50">{module.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-stone-300/72">{module.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="relative flex items-center justify-center px-6 py-24 sm:px-10 lg:px-12">
          <div className="w-full max-w-xl space-y-6">
            <div className="space-y-4 lg:hidden [font-family:var(--font-brand)]">
              <div className="inline-flex items-center gap-3 text-sm uppercase tracking-[0.28em] text-muted-foreground/90">
                <span className="inline-flex size-11 items-center justify-center border border-amber-400/45 bg-amber-400/10 text-lg text-amber-500 dark:text-amber-300">
                  T
                </span>
                TrakrAI Cloud
              </div>
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.3em] text-amber-600 dark:text-amber-300">
                  {authView.eyebrow}
                </p>
                <h1 className="font-[var(--font-display)] text-4xl leading-none text-balance">
                  {authView.heroTitle}
                </h1>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  {authView.heroBody}
                </p>
              </div>
            </div>

            <div className="border border-border/65 bg-background/88 p-7 shadow-[0_24px_80px_-42px_rgba(0,0,0,0.42)] backdrop-blur sm:p-9">
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-amber-600 dark:text-amber-300">
                      {authView.kicker}
                    </p>
                    <h2 className="font-[var(--font-display)] text-4xl leading-none text-balance">
                      {authView.title}
                    </h2>
                    <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                      {authView.description}
                    </p>
                  </div>
                  <Link
                    className="inline-flex items-center gap-2 border border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:border-amber-400/60 hover:text-foreground"
                    href="/"
                  >
                    Dashboard
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>

                <div className="grid gap-3 border-y border-border/60 py-5 sm:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      Device Control
                    </p>
                    <p className="text-sm text-foreground">Live feed, PTZ, runtime panels</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      Incident Review
                    </p>
                    <p className="text-sm text-foreground">Violations, tilt data, uploads</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      Scoped Access
                    </p>
                    <p className="text-sm text-foreground">Users, departments, device apps</p>
                  </div>
                </div>

                <AuthComponent />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:hidden">
              {heroStats.map((stat) => (
                <div key={stat.label} className="border border-border/60 bg-background/72 p-4">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-lg">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
