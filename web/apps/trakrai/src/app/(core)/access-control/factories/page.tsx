import { createLoader, type SearchParams } from 'nuqs/server';

import { AccessControlFactoriesPage } from '@/app/(core)/access-control/_components/access-control-factories-page';
import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

const loader = createLoader(paginatedNameSearchParsers);

const AccessControlFactoriesRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.accessControl.listScopeFactories.queryOptions(pageParams),
  );

  return <AccessControlFactoriesPage data={data} />;
};

export default AccessControlFactoriesRoutePage;
