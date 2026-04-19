import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { SysadminDevicesPage } from './_components/sysadmin-devices-page';

const loader = createLoader(paginatedNameSearchParsers);

const SysadminDevicesRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.workspace.listSysadminDevices.queryOptions(pageParams),
  );

  return <SysadminDevicesPage data={data} />;
};

export default SysadminDevicesRoutePage;
