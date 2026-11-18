import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@skybook/shared'],
  devIndicators: false
};

export default nextConfig;