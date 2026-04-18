'use client';

import Link from 'next/link';

import { AppHeader } from '@trakrai/design-system/components/app-header';
import { ThemeToggleButton } from '@trakrai/design-system/components/theme-toggle-button';

export const EdgeCoreHeader = () => (
  <AppHeader
    leftContent={
      <Link href="/">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">TrakrAI Edge</h1>
      </Link>
    }
    rightContent={<ThemeToggleButton />}
  />
);
