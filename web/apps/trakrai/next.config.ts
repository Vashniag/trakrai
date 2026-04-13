import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: ['@trakrai/design-system', '@trakrai/live-ui'],
};

export default nextConfig;
