import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Locally the variables live in the .env at the repository root, shared with the ticket-service.
// Variables already set (Vercel, Playwright) win over the file.
const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ["@nexo/shared", "@nexo/agent"],
};

export default nextConfig;
