import { createLoader, type SearchParams } from 'nuqs/server';

import { paginatedNameSearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

import { DepartmentWorkspacePage } from './_components/department-workspace-page';

const loader = createLoader(paginatedNameSearchParsers);

const DepartmentWorkspaceRoutePage = async ({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}>) => {
  const [{ id }, pageParams] = await Promise.all([params, loader(searchParams)]);
  const data = await fetchQuery((trpc) =>
    trpc.workspace.getDepartmentWorkspace.queryOptions({
      departmentId: id,
      ...pageParams,
    }),
  );

  return <DepartmentWorkspacePage data={data} />;
};

export default DepartmentWorkspaceRoutePage;
