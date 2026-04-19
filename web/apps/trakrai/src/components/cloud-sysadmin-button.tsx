'use client';

import { useSyncExternalStore } from 'react';

import Link from 'next/link';

import { Button } from '@trakrai/design-system/components/button';

import { useSession } from '@/lib/auth-client';

const isSysadmin = (role: string | null | undefined): boolean =>
  (role ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('admin');

export const CloudSysadminButton = () => {
  const { data } = useSession();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!mounted || !isSysadmin(data?.user.role)) {
    return null;
  }

  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/sysadmin/factories">Sysadmin</Link>
    </Button>
  );
};
