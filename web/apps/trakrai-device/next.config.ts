import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    unoptimized: true,
  },
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: [
    '@trakrai/cloud-transfer-ui',
    '@trakrai/design-system',
    '@trakrai/live-transport',
    '@trakrai/live-ui',
    '@trakrai/live-viewer',
    '@trakrai/ptz-controller',
    '@trakrai/runtime-manager-ui',
    '@trakrai/webrtc',
  ],
};

export default nextConfig;
