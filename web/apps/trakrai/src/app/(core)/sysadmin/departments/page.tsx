import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { SysadminDepartmentsPage } from './_components/sysadmin-departments-page';

const loader = createLoader(paginatedNameSearchParsers);

const SysadminDepartmentsRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.workspace.listSysadminDepartments.queryOptions(pageParams),
  );

  return <SysadminDepartmentsPage data={data} />;
};

export default SysadminDepartmentsRoutePage;
