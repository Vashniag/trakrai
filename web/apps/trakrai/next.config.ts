import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: [
    '@trakrai/cloud-transfer-ui',
    '@trakrai/backend',
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
