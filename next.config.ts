import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "ws"],
  experimental: {
    // The CLI is spawned as a detached child, which can lose captured stdout
    // in local/sandboxed process environments. The compiler API is equivalent
    // here and keeps production builds deterministic.
    useTypeScriptCli: false,
    // Every route imports the same local SQLite store. Serial page-data
    // collection avoids build workers racing through database initialization.
    cpus: 1,
  },
};

export default config;
