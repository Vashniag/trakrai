'use client';

import { type ReactNode } from 'react';

import Link from 'next/link';

import { AppHeader } from '@trakrai/design-system/components/app-header';
import { ThemeToggleButton } from '@trakrai/design-system/components/theme-toggle-button';

import { CloudSysadminButton } from '@/components/cloud-sysadmin-button';
import { CloudUserButton } from '@/components/cloud-user-button';

type CloudCoreHeaderProps = {
  leftContent?: ReactNode;
};

export const CloudCoreHeader = ({ leftContent }: CloudCoreHeaderProps) => (
  <AppHeader
    className="sticky top-0"
    leftContent={leftContent}
    rightContent={
      <>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            className="text-muted-foreground hover:text-foreground transition-colors"
            href="/factories"
          >
            Factories
          </Link>
        </nav>
        <CloudSysadminButton />
        <ThemeToggleButton />
        <CloudUserButton />
      </>
    }
  />
);
