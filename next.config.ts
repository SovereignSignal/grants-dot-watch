import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/model', destination: '/model/index.html', permanent: false },
      { source: '/model/', destination: '/model/index.html', permanent: false },
    ];
  },
  reactCompiler: true,
  outputFileTracingIncludes: {
    // registry files are the dataset; ship them with the server build
    '/**': ['./registry/**'],
  },
};

export default nextConfig;
