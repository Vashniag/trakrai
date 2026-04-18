'use client';

import { DeviceManagementPage } from './_components/device-management-page';

const DevicesPage = () => (
  <main className="bg-background min-h-screen px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight">
              Device management
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
              Register cloud-managed devices, inspect their fixed access tokens, and control whether
              they are allowed to authenticate.
            </p>
          </div>
        </div>
      </section>
      <DeviceManagementPage />
    </div>
  </main>
);

export default DevicesPage;
