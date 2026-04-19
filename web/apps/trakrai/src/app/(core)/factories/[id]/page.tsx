import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { FactoryWorkspacePage } from './_components/factory-workspace-page';

const loader = createLoader(paginatedNameSearchParsers);

const FactoryWorkspaceRoutePage = async ({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}>) => {
  const [{ id }, pageParams] = await Promise.all([params, loader(searchParams)]);
  const data = await fetchQuery((trpc) =>
    trpc.workspace.getFactoryWorkspace.queryOptions({
      factoryId: id,
      ...pageParams,
    }),
  );

  return <FactoryWorkspacePage data={data} />;
};

export default FactoryWorkspaceRoutePage;
