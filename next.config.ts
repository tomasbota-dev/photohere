import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    nodeMiddleware: false,
  },
};

export default config;
