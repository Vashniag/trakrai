import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: [
    '@trakrai/design-system',
    '@trakrai/live-transport',
    '@trakrai/live-ui',
    '@trakrai/live-viewer',
    '@trakrai/ptz-controller',
  ],
};

export default nextConfig;
