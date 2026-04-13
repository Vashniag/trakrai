import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: ['@trakrai/design-system'],
};

export default nextConfig;
