'use client';

import Link from 'next/link';

import { AppHeader } from '@trakrai/design-system/components/app-header';
import { ThemeToggleButton } from '@trakrai/design-system/components/theme-toggle-button';

import { CloudSysadminButton } from '@/components/cloud-sysadmin-button';
import { CloudUserButton } from '@/components/cloud-user-button';

export const CloudCoreHeader = () => (
  <AppHeader
    leftContent={
      <div className="flex items-center gap-4">
        <Link href="/">
          <h1 className="text-foreground text-lg font-semibold tracking-tight">TrakrAI Cloud</h1>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            className="text-muted-foreground hover:text-foreground transition-colors"
            href="/factories"
          >
            Factories
          </Link>
        </nav>
      </div>
    }
    rightContent={
      <>
        <CloudSysadminButton />
        <ThemeToggleButton />
        <CloudUserButton />
      </>
    }
  />
);
