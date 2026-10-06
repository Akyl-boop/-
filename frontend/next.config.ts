import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // In production a reverse proxy (Caddy) routes /api to the backend directly.
  // These rewrites make local development and single-container setups work too.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/telegram/:path*", destination: `${backend}/telegram/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
