import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-first app: no telemetry-dependent features, no remote images.
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  images: { unoptimized: true },
};

export default nextConfig;
