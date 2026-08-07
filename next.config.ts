import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal node_modules — keeps the runtime
  // image small and lets us run `node server.js` without the full dep tree.
  output: "standalone",
};

export default nextConfig;
