import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { SysadminFactoriesPage } from './_components/sysadmin-factories-page';

const loader = createLoader(paginatedNameSearchParsers);

const SysadminFactoriesRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.workspace.listSysadminFactories.queryOptions(pageParams),
  );

  return <SysadminFactoriesPage data={data} />;
};

export default SysadminFactoriesRoutePage;
