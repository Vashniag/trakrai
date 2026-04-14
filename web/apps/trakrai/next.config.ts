import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
