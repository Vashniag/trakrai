import { createLoader, type SearchParams } from 'nuqs/server';

import { AccessControlUsersPage } from '@/app/(core)/access-control/_components/access-control-users-page';
import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

const loader = createLoader(paginatedNameSearchParsers);

const AccessControlUsersRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) => trpc.accessControl.listUsers.queryOptions(pageParams));

  return <AccessControlUsersPage data={data} />;
};

export default AccessControlUsersRoutePage;
