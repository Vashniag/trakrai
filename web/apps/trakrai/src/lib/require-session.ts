import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

const requireSession = async () => {
  const requestHeaders = new Headers(await headers());
  const { response: session } = await auth.api.getSession({
    headers: requestHeaders,
    returnHeaders: true,
  });

  if (!session) {
    redirect('/auth/login');
  }

  return session;
};

export { requireSession };
