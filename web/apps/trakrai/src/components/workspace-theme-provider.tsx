'use client';

import { ThemeProvider } from 'next-themes';

import type { ReactNode } from 'react';

const WorkspaceThemeProvider = ({ children }: { children: ReactNode }) => (
  <ThemeProvider
    attribute="class"
    defaultTheme="dark"
    disableTransitionOnChange
    enableSystem
  >
    {children}
  </ThemeProvider>
);

export { WorkspaceThemeProvider };
