'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import { LogOut } from 'lucide-react';

import { signOut } from '@/lib/auth-client';

export const SessionActions = () => {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  return (
    <Button
      className="rounded-full border border-border/70 bg-background/80 text-foreground"
      disabled={isPending}
      type="button"
      variant="outline"
      onClick={async () => {
        setIsPending(true);
        await signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push('/auth/sign-in');
              router.refresh();
            },
          },
        });
        setIsPending(false);
      }}
    >
      <LogOut className="size-4" />
      {isPending ? 'Signing out...' : 'Sign out'}
    </Button>
  );
};
