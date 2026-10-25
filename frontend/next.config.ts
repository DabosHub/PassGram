import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "path";

// Load secrets from the monorepo root (passgram/.env.local), not from frontend/.
loadEnvConfig(path.join(__dirname, ".."));

function contentSecurityPolicy(): string {
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline' https://telegram.org"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src https:",
  ].join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  // The chain pass lives in bot-service and is imported by the Vercel app.
  experimental: { externalDir: true },
  webpack: (config) => {
    config.resolve.modules = [path.join(__dirname, "node_modules"), ...(config.resolve.modules ?? ["node_modules"])];
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
