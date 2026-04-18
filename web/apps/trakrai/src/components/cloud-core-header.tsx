'use client';

import Link from 'next/link';

import { AppHeader } from '@trakrai/design-system/components/app-header';
import { ThemeToggleButton } from '@trakrai/design-system/components/theme-toggle-button';

import { CloudUserButton } from '@/components/cloud-user-button';

export const CloudCoreHeader = () => (
  <AppHeader
    leftContent={
      <Link href="/">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">TrakrAI Cloud</h1>
      </Link>
    }
    rightContent={
      <>
        <ThemeToggleButton />
        <CloudUserButton />
      </>
    }
  />
);
