import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nexo/shared", "@nexo/agent"],
};

export default nextConfig;
