import { redirect } from 'next/navigation';

import { fetchQuery } from '@/server/server';

const FactoriesLandingPage = async () => {
  const factories = await fetchQuery((trpc) => trpc.workspace.listFactoriesNav.queryOptions());
  const firstFactory = factories[0];

  if (firstFactory !== undefined) {
    redirect(`/factories/${firstFactory.id}`);
  }

  return (
    <main className="bg-background min-h-[calc(100vh-3.5rem)] px-6 py-8 md:px-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <section className="space-y-3 border p-6">
          <h1 className="text-lg font-semibold tracking-tight">No factories available</h1>
          <p className="text-muted-foreground text-sm">
            Open the sysadmin panel to create a factory and attach departments and devices.
          </p>
        </section>
      </div>
    </main>
  );
};

export default FactoriesLandingPage;
