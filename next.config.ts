import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  outputFileTracingIncludes: {
    // registry files are the dataset; ship them with the server build
    '/**': ['./registry/**'],
  },
  async redirects() {
    return [
      {
        source: '/orgs/openssf-technical-initiative-funding',
        destination: '/orgs/openssf',
        permanent: true,
      },
      {
        source: '/orgs/alpha-omega',
        destination: '/orgs/openssf',
        permanent: true,
      },
      {
        source: '/programs/strengthening-lfx-mentoring-a-fairer-stipend-model-and-a-sha',
        destination: '/programs/lfx-mentorship',
        permanent: true,
      },
      {
        source: '/programs/linux-foundation-scholarships-and-travel-funding-for-open-so',
        destination: '/programs/linux-foundation-travel-funding',
        permanent: true,
      },
      {
        source: '/programs/alpha-omega-openssf-grants',
        destination: '/programs/alpha-omega',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
