import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deploy URLs exist at build time, but Netlify only provides the site URL at runtime.
  // Capture these public addresses so preview and production origin checks both work.
  env: process.env.NETLIFY === "true" ? {
    MOQI_NETLIFY_SITE_ORIGIN: process.env.URL ?? "",
    MOQI_NETLIFY_DEPLOY_ORIGIN: process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? "",
    MOQI_NETLIFY_DEPLOY_URL: process.env.DEPLOY_URL ?? "",
  } : {},
};

export default nextConfig;
