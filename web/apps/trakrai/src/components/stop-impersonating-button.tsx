'use client';

import { Button } from '@trakrai/design-system/components/button';

import { authClient, useSession } from '@/lib/auth-client';

export const StopImpersonatingButton = () => {
  const { data } = useSession();
  const isImpersonating =
    data?.session.impersonatedBy !== null && data?.session.impersonatedBy !== undefined;

  if (!isImpersonating) {
    return null;
  }

  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      onClick={async () => {
        await authClient.admin.stopImpersonating();
        window.location.href = '/access-control/users';
      }}
    >
      Stop impersonating
    </Button>
  );
};
