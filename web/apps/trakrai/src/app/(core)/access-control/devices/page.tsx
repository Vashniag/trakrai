import { createLoader, type SearchParams } from 'nuqs/server';

import { AccessControlDevicesPage } from '@/app/(core)/access-control/_components/access-control-devices-page';
import { paginatedHierarchySearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

const loader = createLoader(paginatedHierarchySearchParsers);

const AccessControlDevicesRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.accessControl.listScopeDevices.queryOptions(pageParams),
  );

  return <AccessControlDevicesPage data={data} />;
};

export default AccessControlDevicesRoutePage;
