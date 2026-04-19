import { redirect } from 'next/navigation';

import { fetchQuery } from '@/server/server';

const AccessControlIndexPage = async () => {
  const navigation = await fetchQuery((trpc) => trpc.accessControl.getNavigation.queryOptions());
  redirect(navigation.defaultHref);
};

export default AccessControlIndexPage;
