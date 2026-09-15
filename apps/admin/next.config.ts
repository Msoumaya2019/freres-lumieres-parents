import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@flp/firebase-config',
    '@flp/shared',
    '@flp/types',
    '@flp/validation',
  ],
};

export default nextConfig;
