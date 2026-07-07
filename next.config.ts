import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    // registry files are the dataset; ship them with the server build
    '/**': ['./registry/**'],
  },
};

export default nextConfig;
