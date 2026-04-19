import { createLoader, type SearchParams } from 'nuqs/server';

import { AccessControlDepartmentsPage } from '@/app/(core)/access-control/_components/access-control-departments-page';
import { paginatedHierarchySearchParsers } from '@/components/hierarchy/page-params';
import { fetchQuery } from '@/server/server';

const loader = createLoader(paginatedHierarchySearchParsers);

const AccessControlDepartmentsRoutePage = async ({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) => {
  const pageParams = await loader(searchParams);
  const data = await fetchQuery((trpc) =>
    trpc.accessControl.listScopeDepartments.queryOptions(pageParams),
  );

  return <AccessControlDepartmentsPage data={data} />;
};

export default AccessControlDepartmentsRoutePage;
