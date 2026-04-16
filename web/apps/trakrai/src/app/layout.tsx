import { DM_Sans, Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';

import './globals.css';
import { Toaster } from '@trakrai/design-system/components/sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
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

const instrumentSerif = Instrument_Serif({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400'],
});

const dmSans = DM_Sans({
  variable: '--font-brand',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'TrakrAI Cloud',
    template: '%s | TrakrAI Cloud',
  },
  description: 'Unified cloud operations for TrakrAI devices, workflows, safety events, and team access.',
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html lang="en" suppressHydrationWarning>
    <body
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${dmSans.variable} min-h-screen bg-background text-foreground antialiased`}
    >
      <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange enableSystem>
        <NuqsAdapter>
          <TRPCReactProvider>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-end p-4 sm:p-6">
              <div className="pointer-events-auto">
                <ThemeToggle />
              </div>
            </div>
            {children}
          </TRPCReactProvider>
          <Toaster />
        </NuqsAdapter>
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
