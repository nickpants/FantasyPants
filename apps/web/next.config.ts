import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sleepercdn.com",
        pathname: "/avatars/**",
      },
    ],
  },
};

export default nextConfig;
