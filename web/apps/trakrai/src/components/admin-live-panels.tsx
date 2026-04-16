'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';

import { Button } from '@trakrai/design-system/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { Input } from '@trakrai/design-system/components/input';
import { Label } from '@trakrai/design-system/components/label';
import { cn } from '@trakrai/design-system/lib/utils';
import { AlertTriangle, ArrowUpRight, Building2, RefreshCcw } from 'lucide-react';

import { toneClasses } from '@/components/admin-types';
import { api } from '@/server/react';

import type { FormEvent, ReactNode } from 'react';

const fieldClassName =
  'border border-border/70 bg-background/55 p-3 text-xs text-foreground';

const selectClassName =
  'h-8 w-full rounded-none border border-input bg-transparent px-2.5 py-1 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50';

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

const formatRole = (role: string | null | undefined) => {
  if (!role) {
    return 'user';
  }

  return role.replaceAll('_', ' ');
};

const SectionFrame = ({
  description,
  eyebrow,
  title,
  children,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) => (
  <div className="space-y-6">
    <Card className="border-primary/15 bg-card/85">
      <CardHeader className="border-b border-border/70">
        <CardDescription className="text-[0.68rem] font-semibold tracking-[0.28em] text-primary uppercase">
          {eyebrow}
        </CardDescription>
        <CardTitle className="text-3xl text-foreground sm:text-4xl">{title}</CardTitle>
        <CardDescription className="max-w-3xl text-sm">{description}</CardDescription>
      </CardHeader>
    </Card>
    {children}
  </div>
);

const LoadingPanel = ({ label }: { label: string }) => (
  <Card className="border-primary/10 bg-card/80">
    <CardHeader>
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        {label}
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Loading console data</CardTitle>
    </CardHeader>
  </Card>
);

const QueryErrorCard = ({ message }: { message: string }) => (
  <Card className="border-rose-500/20 bg-rose-500/10">
    <CardHeader>
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-rose-200 uppercase">
        Query issue
      </CardDescription>
      <CardTitle className="flex items-center gap-2 text-lg text-rose-50">
        <AlertTriangle className="size-4" />
        Unable to load this lane right now
      </CardTitle>
      <CardDescription className="text-rose-100/85">{message}</CardDescription>
    </CardHeader>
  </Card>
);

const SetupPanel = ({ email }: { email: string }) => (
  <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
    <CardHeader className="border-b border-primary/20">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
        Admin bootstrap
      </CardDescription>
      <CardTitle className="text-2xl text-foreground">This account is signed in but not elevated yet</CardTitle>
      <CardDescription className="max-w-2xl">
        The backend is ready, but this console only unlocks once your account is marked as a platform admin.
      </CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 pt-4 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-3">
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Current account
          </p>
          <p className="mt-2 text-sm text-foreground">{email}</p>
        </div>
        <div className={fieldClassName}>
          <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
            Bootstrap command
          </p>
          <code className="mt-2 block whitespace-pre-wrap text-[0.72rem] text-foreground">
            pnpm --filter trakrai admin:bootstrap -- --email {email}
          </code>
        </div>
      </div>
      <div className="space-y-3">
        <div className="border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          The command updates the Better Auth user row to role `admin`, which unlocks the admin procedures and UI.
        </div>
        <Button asChild className="w-full border border-primary/40 bg-primary text-primary-foreground">
          <Link href="/auth/login">Switch account</Link>
        </Button>
      </div>
    </CardContent>
  </Card>
);

const Field = ({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) => (
  <label className="space-y-2">
    <Label className="text-[0.68rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {label}
    </Label>
    {children}
  </label>
);

const BootstrapGate = ({
  children,
}: {
  children: (bootstrap: { email: string; isAdmin: boolean }) => ReactNode;
}) => {
  const bootstrapQuery = api.admin.bootstrapStatus.useQuery();

  if (bootstrapQuery.isLoading) {
    return <LoadingPanel label="Session check" />;
  }

  if (bootstrapQuery.error) {
    return <QueryErrorCard message={bootstrapQuery.error.message} />;
  }

  const bootstrap = bootstrapQuery.data;

  if (!bootstrap) {
    return <QueryErrorCard message="The current session could not be resolved." />;
  }

  if (!bootstrap.isAdmin) {
    return <SetupPanel email={bootstrap.user.email} />;
  }

  return children({
    email: bootstrap.user.email,
    isAdmin: bootstrap.isAdmin,
  });
};

const AdminOverviewLive = () => (
  <SectionFrame
    description="Live snapshot of the new cloud control plane: current admin posture, entity counts, and the first meaningful backend wiring behind the new shell."
    eyebrow="Cloud overview"
    title="Admin command posture"
  >
    <BootstrapGate>
      {({ email }) => <AdminOverviewContent email={email} />}
    </BootstrapGate>
  </SectionFrame>
);

const AdminOverviewContent = ({ email }: { email: string }) => {
  const overviewQuery = api.admin.overview.useQuery();

  if (overviewQuery.isLoading) {
    return <LoadingPanel label="Overview" />;
  }

  if (overviewQuery.error) {
    return <QueryErrorCard message={overviewQuery.error.message} />;
  }

  const overview = overviewQuery.data;

  if (!overview) {
    return <QueryErrorCard message="Overview data was not returned." />;
  }

  const metrics = [
    {
      detail: 'Current signed-in platform admin.',
      label: 'Operator',
      tone: 'nominal' as const,
      value: email,
    },
    {
      detail: 'Business scopes currently stored in the new schema.',
      label: 'Hierarchy nodes',
      tone: 'warning' as const,
      value: `${overview.counts.headquarters + overview.counts.factories + overview.counts.departments}`,
    },
    {
      detail: 'Registered device identities available for provisioning.',
      label: 'Fleet size',
      tone: 'warning' as const,
      value: `${overview.counts.devices}`,
    },
    {
      detail: 'First-class event records flowing into the rebuilt cloud schema.',
      label: 'External lanes',
      tone: 'critical' as const,
      value: 'Violation + tilt',
    },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="border-primary/10 bg-card/80" size="sm">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                {metric.label}
              </CardDescription>
              <CardTitle className="break-words text-xl text-foreground">{metric.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-3 text-xs text-muted-foreground">{metric.detail}</CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Canonical counts
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Cloud foundation status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
            {[
              ['Users', overview.counts.users],
              ['Headquarters', overview.counts.headquarters],
              ['Factories', overview.counts.factories],
              ['Departments', overview.counts.departments],
              ['Devices', overview.counts.devices],
              ['Memberships', overview.counts.memberships],
              ['App definitions', overview.counts.appDefinitions],
              ['App grants', overview.counts.appGrants],
            ].map(([label, value]) => (
              <div key={label} className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  {label}
                </p>
                <p className="mt-2 text-xl text-foreground">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Next moves
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Primary admin lanes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {[
              { href: '/hierarchy', label: 'Hierarchy setup' },
              { href: '/users', label: 'User roster' },
              { href: '/devices', label: 'Device provisioning' },
              { href: '/live', label: 'Live workspace' },
            ].map((item) => (
              <Button
                key={item.href}
                asChild
                className="w-full justify-between border border-border bg-transparent text-foreground"
                variant="outline"
              >
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card className="border-primary/10 bg-card/85">
        <CardHeader className="border-b border-border/70">
          <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
            Recent users
          </CardDescription>
          <CardTitle className="text-xl text-foreground">Newest identities in the system</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {overview.recentUsers.length === 0 ? (
            <div className={fieldClassName}>No users have signed up yet.</div>
          ) : (
            overview.recentUsers.map((recentUser) => (
              <div
                key={recentUser.id}
                className="grid gap-3 border border-border/70 bg-background/55 p-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{recentUser.name}</p>
                  <p className="text-xs text-muted-foreground">{recentUser.email}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Created
                  <p className="mt-1 text-sm text-foreground">{formatDate(recentUser.createdAt)}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Role
                  <p className="mt-1 text-sm text-foreground">{formatRole(recentUser.role)}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const AdminHierarchyLive = () => (
  <SectionFrame
    description="Create the business hierarchy for the rebuilt platform and inspect the resulting scope tree the admin model will hang off."
    eyebrow="Org structure"
    title="Placement and delegation map"
  >
    <BootstrapGate>{() => <AdminHierarchyContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminHierarchyContent = () => {
  const snapshotQuery = api.hierarchy.snapshot.useQuery();
  const createHeadquarter = api.hierarchy.createHeadquarter.useMutation();
  const createFactory = api.hierarchy.createFactory.useMutation();
  const createDepartment = api.hierarchy.createDepartment.useMutation();

  const headquarters = snapshotQuery.data?.headquarters ?? [];
  const factories = snapshotQuery.data?.factories ?? [];
  const departments = snapshotQuery.data?.departments ?? [];
  const devices = snapshotQuery.data?.devices ?? [];

  const refreshSnapshot = async () => {
    await snapshotQuery.refetch();
  };

  const onCreateHeadquarter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await createHeadquarter.mutateAsync({
      slug: String(formData.get('slug') ?? '').trim(),
      name: String(formData.get('name') ?? '').trim(),
      code: String(formData.get('code') ?? '').trim() || undefined,
      timezone: String(formData.get('timezone') ?? 'Asia/Kolkata').trim(),
      metadata: {},
    });
    event.currentTarget.reset();
    await refreshSnapshot();
  };

  const onCreateFactory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await createFactory.mutateAsync({
      headquarterId: String(formData.get('headquarterId') ?? ''),
      slug: String(formData.get('slug') ?? '').trim(),
      name: String(formData.get('name') ?? '').trim(),
      code: String(formData.get('code') ?? '').trim() || undefined,
      timezone: String(formData.get('timezone') ?? '').trim() || undefined,
      metadata: {},
    });
    event.currentTarget.reset();
    await refreshSnapshot();
  };

  const onCreateDepartment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await createDepartment.mutateAsync({
      factoryId: String(formData.get('factoryId') ?? ''),
      slug: String(formData.get('slug') ?? '').trim(),
      name: String(formData.get('name') ?? '').trim(),
      code: String(formData.get('code') ?? '').trim() || undefined,
      metadata: {},
    });
    event.currentTarget.reset();
    await refreshSnapshot();
  };

  if (snapshotQuery.isLoading) {
    return <LoadingPanel label="Hierarchy" />;
  }

  if (snapshotQuery.error) {
    return <QueryErrorCard message={snapshotQuery.error.message} />;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Headquarters', headquarters.length, 'nominal'],
          ['Factories', factories.length, 'warning'],
          ['Departments', departments.length, 'warning'],
          ['Attached devices', devices.length, 'critical'],
        ].map(([label, value, tone]) => (
          <Card key={label} className="border-primary/10 bg-card/80" size="sm">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                {label}
              </CardDescription>
              <CardTitle className="text-xl text-foreground">{value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <span
                className={cn(
                  'border px-2 py-1 text-[0.6rem] tracking-[0.18em] uppercase',
                  toneClasses[tone as keyof typeof toneClasses],
                )}
              >
                live data
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Create root scope
            </CardDescription>
            <CardTitle className="text-xl text-foreground">New headquarter</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="space-y-3" onSubmit={(event) => void onCreateHeadquarter(event)}>
              <Field label="Name">
                <Input name="name" placeholder="North operations" required />
              </Field>
              <Field label="Slug">
                <Input name="slug" placeholder="north-operations" required />
              </Field>
              <Field label="Code">
                <Input name="code" placeholder="NORTH" />
              </Field>
              <Field label="Timezone">
                <Input defaultValue="Asia/Kolkata" name="timezone" required />
              </Field>
              <Button className="w-full" disabled={createHeadquarter.isPending} type="submit">
                {createHeadquarter.isPending ? 'Creating...' : 'Create headquarter'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Create site scope
            </CardDescription>
            <CardTitle className="text-xl text-foreground">New factory</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="space-y-3" onSubmit={(event) => void onCreateFactory(event)}>
              <Field label="Headquarter">
                <select className={selectClassName} name="headquarterId" required>
                  <option value="">Select headquarter</option>
                  {headquarters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <Input name="name" placeholder="Factory A" required />
              </Field>
              <Field label="Slug">
                <Input name="slug" placeholder="factory-a" required />
              </Field>
              <Field label="Code">
                <Input name="code" placeholder="FAC-A" />
              </Field>
              <Field label="Timezone">
                <Input name="timezone" placeholder="Asia/Kolkata" />
              </Field>
              <Button
                className="w-full"
                disabled={createFactory.isPending || headquarters.length === 0}
                type="submit"
              >
                {createFactory.isPending ? 'Creating...' : 'Create factory'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Create team scope
            </CardDescription>
            <CardTitle className="text-xl text-foreground">New department</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="space-y-3" onSubmit={(event) => void onCreateDepartment(event)}>
              <Field label="Factory">
                <select className={selectClassName} name="factoryId" required>
                  <option value="">Select factory</option>
                  {factories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <Input name="name" placeholder="Packaging" required />
              </Field>
              <Field label="Slug">
                <Input name="slug" placeholder="packaging" required />
              </Field>
              <Field label="Code">
                <Input name="code" placeholder="PKG" />
              </Field>
              <Button
                className="w-full"
                disabled={createDepartment.isPending || factories.length === 0}
                type="submit"
              >
                {createDepartment.isPending ? 'Creating...' : 'Create department'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Live hierarchy
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Current scope tree</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {headquarters.length === 0 ? (
              <div className={fieldClassName}>No hierarchy created yet.</div>
            ) : (
              headquarters.map((hq) => {
                const factoryRows = factories.filter((item) => item.headquarterId === hq.id);
                return (
                  <div key={hq.id} className="border border-border/70 bg-background/55 p-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-4 text-primary" />
                      <p className="text-sm font-medium text-foreground">{hq.name}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hq.slug} · {hq.timezone}
                    </p>
                    <div className="mt-3 space-y-2">
                      {factoryRows.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No factories attached yet.</p>
                      ) : (
                        factoryRows.map((factoryRow) => {
                          const departmentRows = departments.filter(
                            (item) => item.factoryId === factoryRow.id,
                          );
                          return (
                            <div
                              key={factoryRow.id}
                              className="border border-border/60 bg-card/70 p-3"
                            >
                              <p className="text-sm font-medium text-foreground">{factoryRow.name}</p>
                              <p className="text-xs text-muted-foreground">{factoryRow.slug}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {departmentRows.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">
                                    No departments yet
                                  </span>
                                ) : (
                                  departmentRows.map((departmentRow) => (
                                    <span
                                      key={departmentRow.id}
                                      className="border border-border/70 px-2 py-1 text-[0.68rem] text-foreground"
                                    >
                                      {departmentRow.name}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Scope posture
            </CardDescription>
            <CardTitle className="text-xl text-foreground">What the hierarchy is ready for</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {[
              'Scoped admin delegation',
              'Department-bound device placement',
              'App grants with hierarchy-aware inheritance',
              'Workflow targeting by scope',
            ].map((item) => (
              <div key={item} className={fieldClassName}>
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
};

const AdminUsersLive = () => (
  <SectionFrame
    description="Inspect the current identity roster behind Better Auth and start shaping the scoped-admin control plane around real users."
    eyebrow="Users and access"
    title="Identity, scope, and app access"
  >
    <BootstrapGate>{() => <AdminUsersContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminUsersContent = () => {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const usersQuery = api.admin.listUsers.useQuery(
    deferredSearch.length > 0 ? { limit: 100, search: deferredSearch } : { limit: 100 },
  );

  if (usersQuery.isLoading) {
    return <LoadingPanel label="Users" />;
  }

  if (usersQuery.error) {
    return <QueryErrorCard message={usersQuery.error.message} />;
  }

  const users = usersQuery.data?.users ?? [];

  return (
    <div className="space-y-6">
      <Card className="border-primary/10 bg-card/85">
        <CardHeader className="border-b border-border/70">
          <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
            Search roster
          </CardDescription>
          <CardTitle className="text-xl text-foreground">Current authenticated users</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <Field label="Search">
            <Input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              value={search}
            />
          </Field>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((user) => (
          <Card key={user.id} className="border-primary/10 bg-card/80">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                {formatRole(user.role)}
              </CardDescription>
              <CardTitle className="text-xl text-foreground">{user.name}</CardTitle>
              <CardDescription>{user.email}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  Created
                </p>
                <p className="mt-1 text-sm text-foreground">{formatDate(user.createdAt)}</p>
              </div>
              <div className={fieldClassName}>
                <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                  Status
                </p>
                <p className="mt-1 text-sm text-foreground">{user.banned ? 'Banned' : 'Active'}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {users.length === 0 ? (
        <Card className="border-primary/10 bg-card/80">
          <CardContent className="pt-4">No users matched the current filter.</CardContent>
        </Card>
      ) : null}
    </div>
  );
};

const AdminDevicesLive = () => (
  <SectionFrame
    description="Register device identities, issue access tokens, and inspect the first operational fleet view in the rebuilt cloud app."
    eyebrow="Devices and provisioning"
    title="Fleet identity and deployment state"
  >
    <BootstrapGate>{() => <AdminDevicesContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminDevicesContent = () => {
  const devicesQuery = api.devices.list.useQuery();
  const hierarchyQuery = api.hierarchy.snapshot.useQuery();
  const createDevice = api.devices.create.useMutation();
  const rotateToken = api.devices.rotateToken.useMutation();
  const [lastIssuedToken, setLastIssuedToken] = useState<{
    deviceName: string;
    plainTextToken: string;
    tokenPrefix: string;
  } | null>(null);

  const departmentOptions = useMemo(
    () => hierarchyQuery.data?.departments ?? [],
    [hierarchyQuery.data?.departments],
  );

  const refreshDeviceData = async () => {
    await Promise.all([devicesQuery.refetch(), hierarchyQuery.refetch()]);
  };

  const onCreateDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const created = await createDevice.mutateAsync({
      publicId: String(formData.get('publicId') ?? '').trim() || undefined,
      name: String(formData.get('name') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim() || undefined,
      departmentId: String(formData.get('departmentId') ?? '').trim() || null,
      metadata: {},
      tokenLabel: String(formData.get('tokenLabel') ?? '').trim() || 'Primary token',
    });
    setLastIssuedToken({
      deviceName: created.device.name,
      plainTextToken: created.token.plainTextToken,
      tokenPrefix: created.token.tokenPrefix,
    });
    event.currentTarget.reset();
    await refreshDeviceData();
  };

  const onRotateToken = async (deviceId: string, deviceName: string) => {
    const rotated = await rotateToken.mutateAsync({ deviceId });
    setLastIssuedToken({
      deviceName,
      plainTextToken: rotated.token.plainTextToken,
      tokenPrefix: rotated.token.tokenPrefix,
    });
    await refreshDeviceData();
  };

  if (devicesQuery.isLoading || hierarchyQuery.isLoading) {
    return <LoadingPanel label="Devices" />;
  }

  if (devicesQuery.error) {
    return <QueryErrorCard message={devicesQuery.error.message} />;
  }

  if (hierarchyQuery.error) {
    return <QueryErrorCard message={hierarchyQuery.error.message} />;
  }

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <Card className="border-primary/10 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Register device
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Issue a new device identity</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void onCreateDevice(event)}>
              <Field label="Name">
                <Input name="name" placeholder="Gate camera 01" required />
              </Field>
              <Field label="Public device ID">
                <Input name="publicId" placeholder="Optional auto-generated override" />
              </Field>
              <Field label="Department">
                <select className={selectClassName} name="departmentId">
                  <option value="">Unassigned</option>
                  {departmentOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Token label">
                <Input defaultValue="Primary token" name="tokenLabel" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Description">
                  <Input name="description" placeholder="Optional deployment context" />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Button className="w-full" disabled={createDevice.isPending} type="submit">
                  {createDevice.isPending ? 'Registering...' : 'Register device'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
          <CardHeader className="border-b border-primary/20">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Issued token
            </CardDescription>
            <CardTitle className="text-xl text-foreground">Copy this once and store it safely</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {lastIssuedToken ? (
              <>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Device
                  </p>
                  <p className="mt-1 text-sm text-foreground">{lastIssuedToken.deviceName}</p>
                </div>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Token prefix
                  </p>
                  <p className="mt-1 text-sm text-foreground">{lastIssuedToken.tokenPrefix}</p>
                </div>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Plain token
                  </p>
                  <code className="mt-1 block break-all text-[0.72rem] text-foreground">
                    {lastIssuedToken.plainTextToken}
                  </code>
                </div>
              </>
            ) : (
              <div className={fieldClassName}>
                Newly created or rotated tokens will appear here once. The hashed value is stored in Postgres, not the plaintext token.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-primary/10 bg-card/85">
        <CardHeader className="border-b border-border/70">
          <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
            Fleet registry
          </CardDescription>
          <CardTitle className="text-xl text-foreground">Registered devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {devices.length === 0 ? (
            <div className={fieldClassName}>No devices have been registered yet.</div>
          ) : (
            devices.map((device) => (
              <div
                key={device.id}
                className="grid gap-3 border border-border/70 bg-background/55 p-3 xl:grid-cols-[minmax(0,1fr)_220px_220px_auto]"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{device.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.publicId} · {device.status}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {device.headquarterName ?? 'No HQ'} / {device.factoryName ?? 'No factory'} /{' '}
                    {device.departmentName ?? 'No department'}
                  </p>
                </div>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Last seen
                  </p>
                  <p className="mt-1 text-sm text-foreground">{formatDate(device.lastSeenAt)}</p>
                </div>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Registered
                  </p>
                  <p className="mt-1 text-sm text-foreground">{formatDate(device.createdAt)}</p>
                </div>
                <div className="flex items-center xl:justify-end">
                  <Button
                    className="w-full xl:w-auto"
                    disabled={rotateToken.isPending}
                    onClick={() => void onRotateToken(device.id, device.name)}
                    variant="outline"
                  >
                    <RefreshCcw className="size-4" />
                    Rotate token
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const LiveStatusChip = ({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'critical' | 'nominal' | 'warning';
  value: string;
}) => (
  <div
    className={cn(
      'flex items-center justify-between gap-3 border px-3 py-2 text-[0.68rem] tracking-[0.18em] uppercase',
      toneClasses[tone],
    )}
  >
    <span>{label}</span>
    <span className="text-right text-[0.62rem] text-current/90">{value}</span>
  </div>
);

const RouteTile = ({
  description,
  href,
  label,
  meta,
}: {
  description: string;
  href: string;
  label: string;
  meta: string;
}) => (
  <Link
    className="border border-border/70 bg-background/55 p-3 transition-colors hover:border-primary/30 hover:bg-background"
    href={href}
  >
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <ArrowUpRight className="size-4 text-primary" />
    </div>
    <p className="mt-2 text-[0.65rem] font-semibold tracking-[0.2em] text-primary uppercase">
      {meta}
    </p>
    <p className="mt-2 text-xs text-muted-foreground">{description}</p>
  </Link>
);

const EndpointCard = ({
  detail,
  method,
  path,
  tone,
}: {
  detail: string;
  method: string;
  path: string;
  tone: 'critical' | 'nominal' | 'warning';
}) => (
  <div className="border border-border/70 bg-background/55 p-3">
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'border px-2 py-1 text-[0.6rem] tracking-[0.18em] uppercase',
          toneClasses[tone],
        )}
      >
        {method}
      </span>
      <code className="text-[0.72rem] text-foreground">{path}</code>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
  </div>
);

const AdminAppsLive = () => (
  <SectionFrame
    description="Turn the app catalog into an operational surface: show what is already live, what still needs grants, and where future ACL work will plug in."
    eyebrow="Apps and modules"
    title="Application access catalog"
  >
    <BootstrapGate>{() => <AdminAppsContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminAppsContent = () => {
  const appsQuery = api.admin.listApps.useQuery();
  const seedSystemApps = api.admin.seedSystemApps.useMutation();

  if (appsQuery.isLoading) {
    return <LoadingPanel label="Apps" />;
  }

  if (appsQuery.error) {
    return <QueryErrorCard message={appsQuery.error.message} />;
  }

  const apps = appsQuery.data?.apps ?? [];
  const blueprint = appsQuery.data?.systemBlueprint ?? [];

  const onSeedApps = async () => {
    await seedSystemApps.mutateAsync();
    await appsQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              App definitions
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {apps.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Application records persisted in Postgres and ready for explicit grants.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Blueprint entries
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{blueprint.length}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Default system app surfaces we can seed or refresh from the console.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              System apps
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {apps.filter((item) => item.isSystem).length}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Built-in operational surfaces the platform owns directly.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Empty slots
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {Math.max(blueprint.length - apps.length, 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Default surfaces that still need to be seeded into the canonical catalog.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Visible app lanes
              </CardDescription>
              <CardTitle className="text-xl text-foreground">
                Persisted catalog records
              </CardTitle>
              <CardDescription>
                This catalog is the future ACL target set, so the live records matter more than the shell copy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {apps.length === 0 ? (
                <div className={fieldClassName}>
                  No app definitions are stored yet. Seed the system blueprint so grants and ACL work have a stable catalog.
                </div>
              ) : (
                apps.map((app) => (
                  <div
                    key={app.id}
                    className="grid gap-3 border border-border/70 bg-background/55 p-3 md:grid-cols-[minmax(0,1fr)_160px_140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{app.name}</p>
                      <p className="text-xs text-muted-foreground">{app.key}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {app.description ?? 'No description provided yet.'}
                      </p>
                    </div>
                    <div className={fieldClassName}>
                      <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                        Category
                      </p>
                      <p className="mt-1 text-sm text-foreground">{app.category}</p>
                    </div>
                    <div className={fieldClassName}>
                      <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                        Type
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        {app.isSystem ? 'System app' : 'Custom'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Blueprint seeding
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Create the base app inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className="space-y-2">
                {blueprint.map((app) => (
                  <div key={app.key} className="border border-border/70 bg-background/55 p-3">
                    <p className="text-sm font-medium text-foreground">{app.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{app.description}</p>
                  </div>
                ))}
              </div>
              <Button className="w-full" disabled={seedSystemApps.isPending} onClick={() => void onSeedApps()}>
                {seedSystemApps.isPending ? 'Seeding catalog...' : 'Seed or refresh system apps'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-30">
          <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
            <CardHeader className="border-b border-primary/20">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Policy rail
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Operator design rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs text-muted-foreground">
              <div className={fieldClassName}>
                App access stays explicit. The catalog is the target set, and grants will layer scope inheritance on top of it.
              </div>
              <div className={fieldClassName}>
                Business meaning belongs in apps and workflow nodes, not in gateways or transport intermediates.
              </div>
              <div className={fieldClassName}>
                Seeding the system catalog now keeps future RBAC, ACL, and ABAC work grounded in stable identifiers instead of UI copy.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

const AdminWorkflowsLive = () => (
  <SectionFrame
    description="Keep cloud and edge workflow systems visible in one console without collapsing their responsibilities together."
    eyebrow="Workflow systems"
    title="Cloud and edge workflow lanes"
  >
    <BootstrapGate>{() => <AdminWorkflowsContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminWorkflowsContent = () => {
  const overviewQuery = api.admin.overview.useQuery();
  const devicesQuery = api.devices.list.useQuery();
  const healthQuery = api.health.useQuery();

  if (overviewQuery.isLoading || devicesQuery.isLoading || healthQuery.isLoading) {
    return <LoadingPanel label="Workflows" />;
  }

  if (overviewQuery.error) {
    return <QueryErrorCard message={overviewQuery.error.message} />;
  }
  if (devicesQuery.error) {
    return <QueryErrorCard message={devicesQuery.error.message} />;
  }
  if (healthQuery.error) {
    return <QueryErrorCard message={healthQuery.error.message} />;
  }

  const counts = overviewQuery.data?.counts;
  if (!counts) {
    return <QueryErrorCard message="Workflow counts were not returned." />;
  }

  const devices = devicesQuery.data?.devices ?? [];
  const recentlySeenDevices = devices.filter((item) => {
    if (!item.lastSeenAt) {
      return false;
    }
    return Date.now() - new Date(item.lastSeenAt).getTime() <= 15 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Execution models
            </CardDescription>
            <CardTitle className="text-xl text-foreground">2</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Cloud workflows run in the platform; device workflows execute against edge frames and services.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Addressable devices
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{devices.length}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Registered edge identities that can eventually receive workflow packs and schema hashes.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Recent check-ins
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{recentlySeenDevices}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Devices seen in the last 15 minutes, which is the first useful signal for future distribution health.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Schema posture
            </CardDescription>
            <CardTitle className="text-xl text-foreground">
              {counts.headquarters + counts.factories + counts.departments > 0 ? 'Scoped' : 'Bootstrapping'}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            The shell is ready to separate cloud graphs from edge packs while still sharing the same operator context.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Workflow lanes
              </CardDescription>
              <CardTitle className="text-xl text-foreground">
                Separate runtimes, one operator story
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
              <div className="border border-border/70 bg-background/55 p-4">
                <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-primary uppercase">
                  Cloud workflow lane
                </p>
                <p className="mt-3 text-lg text-foreground">Author, persist, and execute in platform space.</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  This is where Fluxery-style packages, cloud event handlers, and post-ingestion business logic belong.
                </p>
              </div>
              <div className="border border-border/70 bg-background/55 p-4">
                <p className="text-[0.68rem] font-semibold tracking-[0.2em] text-primary uppercase">
                  Edge workflow lane
                </p>
                <p className="mt-3 text-lg text-foreground">Consume frame envelopes and call local services.</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Device workflows stay near inference outputs, but they remain a separate runtime and a separate distribution concern.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Distribution posture
              </CardDescription>
              <CardTitle className="text-xl text-foreground">What the operator can infer today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Registered fleet
                  </p>
                  <p className="mt-1 text-sm text-foreground">{devices.length} device identities</p>
                </div>
                <div className={fieldClassName}>
                  <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                    Health timestamp
                  </p>
                  <p className="mt-1 text-sm text-foreground">{formatDate(healthQuery.data?.timestamp)}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <LiveStatusChip
                  label="Cloud runtime"
                  tone="warning"
                  value="Builder lane next"
                />
                <LiveStatusChip
                  label="Edge runtime"
                  tone={devices.length > 0 ? 'nominal' : 'warning'}
                  value={devices.length > 0 ? 'Fleet ready' : 'Need devices'}
                />
                <LiveStatusChip
                  label="Boundary rule"
                  tone="nominal"
                  value="Intermediates stay generic"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-30">
          <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
            <CardHeader className="border-b border-primary/20">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Workflow rail
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Migration guardrails</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs text-muted-foreground">
              <div className={fieldClassName}>
                Device workflow artifacts should stay schema-driven and deployable without pulling cloud execution concerns onto the edge.
              </div>
              <div className={fieldClassName}>
                Cloud workflows should react to persisted events, not to internal service packets or gateway-specific payload handling.
              </div>
              <div className={fieldClassName}>
                This page is the handoff point where future schema hashes, versions, and rollout status can live together.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

const AdminEventsLive = () => (
  <SectionFrame
    description="Make the event pipeline legible: metadata path, file path, retry posture, and the first external endpoints all in one screen."
    eyebrow="Metadata and uploads"
    title="Event intake and delivery posture"
  >
    <BootstrapGate>{() => <AdminEventsContent />}</BootstrapGate>
  </SectionFrame>
);

const AdminEventsContent = () => {
  const eventsQuery = api.admin.eventOverview.useQuery();

  if (eventsQuery.isLoading) {
    return <LoadingPanel label="Events" />;
  }

  if (eventsQuery.error) {
    return <QueryErrorCard message={eventsQuery.error.message} />;
  }

  const overview = eventsQuery.data;
  if (!overview) {
    return <QueryErrorCard message="Event metrics were not returned." />;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              External messages
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{overview.counts.externalMessages}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Device-originated envelopes accepted or processed by the external event lane.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Violations
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{overview.counts.violations}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Persisted business events coming in through `/trpc/external/violations`.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Tilts
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{overview.counts.tilts}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Persisted tilt events coming in through `/trpc/external/tilts`.
          </CardContent>
        </Card>
        <Card className="border-primary/10 bg-card/80" size="sm">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              Storage objects
            </CardDescription>
            <CardTitle className="text-xl text-foreground">{overview.counts.storageObjects}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Media references currently tracked in the rebuilt storage ledger.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                External lanes
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Business ingress stays at the edges</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
              <EndpointCard
                detail="Workflow nodes can publish a violation intent here after media references are prepared. Cloud decides storage and business handling."
                method="POST"
                path="/trpc/external/violations"
                tone="nominal"
              />
              <EndpointCard
                detail="Tilt reports follow the same edge-defined rule: the endpoint knows the meaning, the intermediate services do not."
                method="POST"
                path="/trpc/external/tilts"
                tone="warning"
              />
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/85">
            <CardHeader className="border-b border-border/70">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Recent events
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Latest persisted business records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {overview.recentEvents.length === 0 ? (
                <div className={fieldClassName}>
                  No violation or tilt events have been reported yet. Once a device posts to the external router, those records will appear here.
                </div>
              ) : (
                overview.recentEvents.map((event) => (
                  <div
                    key={`${event.type}-${event.id}`}
                    className="grid gap-3 border border-border/70 bg-background/55 p-3 lg:grid-cols-[minmax(0,1fr)_140px_180px_160px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.type} · {event.devicePublicId ?? 'Unknown device'}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {event.summary ?? 'No summary supplied with this event.'}
                      </p>
                    </div>
                    <div className={fieldClassName}>
                      <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                        Severity
                      </p>
                      <p className="mt-1 text-sm text-foreground">{event.severity}</p>
                    </div>
                    <div className={fieldClassName}>
                      <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                        Occurred
                      </p>
                      <p className="mt-1 text-sm text-foreground">{formatDate(event.occurredAt)}</p>
                    </div>
                    <div className={fieldClassName}>
                      <p className="text-[0.65rem] font-semibold tracking-[0.22em] text-primary uppercase">
                        Cloud path
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        {event.type === 'violation' ? '/trpc/external/violations' : '/trpc/external/tilts'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-30">
          <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
            <CardHeader className="border-b border-primary/20">
              <CardDescription className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
                Delivery rail
              </CardDescription>
              <CardTitle className="text-xl text-foreground">Operational rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <LiveStatusChip
                label="Gateway"
                tone="nominal"
                value="Forward only"
              />
              <LiveStatusChip
                label="Uploads"
                tone="warning"
                value="Signed URL HTTP"
              />
              <LiveStatusChip
                label="Retry ledger"
                tone="critical"
                value="Durable queue next"
              />
              <div className={fieldClassName}>
                Event endpoints stay explicit and business-aware at the cloud edge; intermediates remain generic.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

export {
  AdminAppsLive,
  AdminDevicesLive,
  AdminEventsLive,
  AdminHierarchyLive,
  AdminOverviewLive,
  AdminUsersLive,
  AdminWorkflowsLive,
};
