import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  agentRules: false,
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@errand/client", "@errand/contracts"],
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
  // Photos are the app's own bundled files, resolved by image key (features/images/registry.ts).
  // The browser loads no image from anywhere else — no URL, no data: URI, no CSS url() — even if
  // model or tool text ever reached the page as markup.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "img-src 'self'" }] }];
  },
};

export default nextConfig;
