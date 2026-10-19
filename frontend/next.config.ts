import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "path";

// Load secrets from the monorepo root (passgram/.env.local), not from frontend/.
loadEnvConfig(path.join(__dirname, ".."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
};

export default nextConfig;
