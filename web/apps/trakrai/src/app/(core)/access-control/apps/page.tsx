import { createLoader, type SearchParams } from 'nuqs/server';

import { AccessControlAppsPage } from '@/app/(core)/access-control/_components/access-control-apps-page';
import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

const loader = createLoader(paginatedNameSearchParsers);

const AccessControlAppsRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.accessControl.listScopeApps.queryOptions(pageParams),
  );

  return <AccessControlAppsPage data={data} />;
};

export default AccessControlAppsRoutePage;
