// The layer table in ARCHITECTURE.md, as rules. `pnpm check:layers` fails on any violation.
// npm packages are matched on their resolved path, which pnpm nests under node_modules/.pnpm.
const npm = (name) => `^node_modules/${name}/|^node_modules/\\.pnpm/[^/]+/node_modules/${name}/`;
const eveEntry = (entry) => `^node_modules/\\.pnpm/[^/]+/node_modules/eve/dist/src/${entry}/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-imports-only-core",
      comment: "src/core is pure: no eve, SQLite, AI SDK, React, Zod, contracts or Node built-ins.",
      severity: "error",
      from: { path: "^src/core/" },
      to: { pathNot: "^src/core/" },
    },
    {
      name: "adapters-and-composition-stay-inward",
      comment: "src/adapters and src/composition never reach the agent or the apps.",
      severity: "error",
      from: { path: "^src/(adapters|composition)/" },
      to: { path: "^(agent|apps|evals)/" },
    },
    {
      name: "only-composition-constructs-adapters",
      comment: "agent/ gets adapters from src/composition, never directly.",
      severity: "error",
      from: { path: "^agent/" },
      to: { path: "^(src/adapters|apps)/" },
    },
    {
      name: "contracts-depend-only-on-zod",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { pathNot: [`^packages/contracts/`, npm("zod")] },
    },
    {
      name: "client-is-headless",
      comment: "packages/client: contracts and the eve client only. No React, no server code.",
      severity: "error",
      from: { path: "^packages/client/" },
      to: { pathNot: ["^packages/(client|contracts)/", npm("zod"), eveEntry("client")] },
    },
    {
      name: "apps-reach-the-backend-only-through-the-client",
      comment: "apps/* never import src/ or agent/, and use eve only through its React binding.",
      severity: "error",
      from: { path: "^apps/" },
      to: { path: ["^(src|agent|evals)/", npm("eve")], pathNot: eveEntry("react") },
    },
    {
      name: "evals-are-clients",
      comment: "evals/ use packages/client and contracts; from src/ only the world adapter, for seeding.",
      severity: "error",
      from: { path: "^evals/" },
      to: { path: ["^agent/", "^src/"], pathNot: "^src/adapters/world/" },
    },
    {
      name: "nothing-depends-on-tests-or-evals",
      severity: "error",
      from: { pathNot: "^evals/" },
      to: { path: ["^evals/", "\\.test\\.ts$"] },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable",
      comment: "An import the cruiser can't resolve could hide a violation.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["\\.next/", "node_modules/\\.cache", "apps/web/next-env\\.d\\.ts"] },
    // Its paths map the web app's "@/" alias, so web imports resolve and get checked too.
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
