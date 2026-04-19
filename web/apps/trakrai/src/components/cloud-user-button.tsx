'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@trakrai/design-system/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@trakrai/design-system/components/dropdown-menu';

import { useSession, signOut } from '@/lib/auth-client';

import type { Route } from 'next';

const fallbackEmail = 'Account';

export const CloudUserButton = () => {
  const router = useRouter();
  const { data } = useSession();

  const email = data?.user.email ?? fallbackEmail;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="max-w-48 truncate" size="sm" variant="outline">
          {email}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            router.push('/devices' as Route);
          }}
        >
          Devices
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            router.push('/access-control' as Route);
          }}
        >
          Access control
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await signOut({
              fetchOptions: {
                onSuccess: () => {
                  router.push('/auth/login' as Route);
                },
              },
            });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
