import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { SysadminAppsPage } from './_components/sysadmin-apps-page';

const loader = createLoader(paginatedNameSearchParsers);

const SysadminAppsRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) => trpc.workspace.listSysadminApps.queryOptions(pageParams));

  return <SysadminAppsPage data={data} />;
};

export default SysadminAppsRoutePage;
