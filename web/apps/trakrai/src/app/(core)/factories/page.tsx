import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

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
        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle>No factories available</CardTitle>
            <CardDescription>
              A sysadmin needs to create a factory before users can browse the hierarchy.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground py-6 text-sm">
            Open the sysadmin panel to create a factory and attach departments and devices.
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default FactoriesLandingPage;
