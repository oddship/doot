import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_DOOT_DEMO_BASE_PATH || "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  experimental: {
    useTypeScriptCli: false,
    cpus: 1,
  },
};

export default config;
