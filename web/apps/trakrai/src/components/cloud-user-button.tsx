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
const isSysadmin = (role: string | null | undefined): boolean =>
  (role ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('admin');

export const CloudUserButton = () => {
  const router = useRouter();
  const { data } = useSession();

  const email = data?.user.email ?? fallbackEmail;
  const showSysadmin = isSysadmin(data?.user.role);

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
            router.push('/factories' as Route);
          }}
        >
          Factories
        </DropdownMenuItem>
        {showSysadmin ? (
          <DropdownMenuItem
            onClick={() => {
              router.push('/sysadmin/factories' as Route);
            }}
          >
            Sysadmin
          </DropdownMenuItem>
        ) : null}
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
