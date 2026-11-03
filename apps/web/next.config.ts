import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  agentRules: false,
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@errand/client", "@errand/contracts"],
  // Next inlines a NEXT_PUBLIC_ variable only when it is set, so the demo switch always gets a value:
  // unset, it inlines as "" and the build drops the demo entirely (features/chat/backend.ts reads it).
  env: { NEXT_PUBLIC_ERRAND_DEMO: process.env.NEXT_PUBLIC_ERRAND_DEMO ?? "" },
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
  // Photos are the app's own bundled files, resolved by image key (features/images/registry.ts).
  // The browser loads no image from anywhere else — no URL, no data: URI, no CSS url() — even if
  // model or tool text ever reached the page as markup.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "img-src 'self'" }] }];
  },
};

export default nextConfig;
