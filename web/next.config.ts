import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The operations views moved under /app; keep the old paths working.
  redirects: async () => [
    { source: "/lp", destination: "/app", permanent: false },
    { source: "/app/lp", destination: "/app", permanent: false },
    { source: "/trade", destination: "/app/trade", permanent: false },
    { source: "/data", destination: "/app/data", permanent: false },
  ],
};

export default nextConfig;
