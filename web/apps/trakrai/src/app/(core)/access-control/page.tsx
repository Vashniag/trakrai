'use client';

import { AccessControlPage } from './_components/access-control-page';

const AccessControlRoutePage = () => (
  <main className="bg-background min-h-screen px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-2">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight">Access control</h1>
        <p className="text-muted-foreground max-w-4xl text-sm">
          Manage hierarchy, device apps, scoped permissions, and sysadmin user lifecycle from one
          place.
        </p>
      </section>
      <AccessControlPage />
    </div>
  </main>
);

export default AccessControlRoutePage;
