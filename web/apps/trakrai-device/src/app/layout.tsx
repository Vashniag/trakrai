import Script from 'next/script';

import { Toaster } from '@trakrai/design-system/components/sonner';

import './globals.css';

import type { Metadata } from 'next';

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
    <body className="antialiased">
      <Script src="/runtime-config.js" strategy="beforeInteractive" />
      {children}
      <Toaster />
    </body>
  </html>
);

export default RootLayout;
