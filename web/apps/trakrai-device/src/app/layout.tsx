import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';

import { Toaster } from '@trakrai/design-system/components/sonner';

import './globals.css';

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
  title: 'TrakrAI Device UI',
  description: 'Static-exportable on-device client for cloud and edge connectivity.',
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html lang="en">
    <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <Script src="/runtime-config.js" strategy="beforeInteractive" />
      {children}
      <Toaster />
    </body>
  </html>
);

export default RootLayout;
