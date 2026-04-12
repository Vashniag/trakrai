import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';
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

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html lang="en" suppressHydrationWarning>
    <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <TRPCReactProvider>{children}</TRPCReactProvider>
    </body>
  </html>
);

export default RootLayout;
