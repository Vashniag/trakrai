import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';

import './globals.css';
import { Toaster } from '@trakrai/design-system/components/sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { ThemeCookieSync } from '@/components/theme-cookie-sync';
import { ThemeProvider } from '@/components/theme-provider';
import { TRPCReactProvider } from '@/server/react';

import type { Metadata } from 'next';

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'TrakrAI',
  description: 'TrakrAI Application',
};

const DEFAULT_THEME = 'system' as const;
const DARK_THEME = 'dark' as const;

const RootLayout = async ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get('theme')?.value;
  const defaultTheme =
    themeCookie === 'light' || themeCookie === DARK_THEME || themeCookie === DEFAULT_THEME
      ? themeCookie
      : DEFAULT_THEME;
  const htmlClassName = defaultTheme === DARK_THEME ? DARK_THEME : undefined;

  return (
    <html className={htmlClassName} lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NuqsAdapter>
          <ThemeProvider
            attribute="class"
            defaultTheme={defaultTheme}
            disableTransitionOnChange
            enableSystem
          >
            <ThemeCookieSync />
            <TRPCReactProvider>{children}</TRPCReactProvider>
            <Toaster />
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
};

export default RootLayout;
