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
      from: { path: "^src/core/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/core/" },
    },
    {
      name: "core-tests-import-only-core-and-vitest",
      comment: "Core's unit tests drive core with in-memory ports: core and the test runner, nothing else.",
      severity: "error",
      from: { path: "^src/core/.*\\.test\\.ts$" },
      to: { pathNot: ["^src/core/", npm("vitest")] },
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
      comment:
        "packages/client: contracts, the eve client and OpenUI's framework-agnostic parser (lang-core) only. No React, no server code.",
      severity: "error",
      from: { path: "^packages/client/" },
      to: { pathNot: ["^packages/(client|contracts)/", npm("zod"), npm("@openuidev/lang-core"), eveEntry("client")] },
    },
    {
      name: "design-tokens-is-a-leaf",
      comment:
        "packages/design-tokens imports nothing in the repo and no npm package: Node built-ins for the CSS build, vitest for its test.",
      severity: "error",
      from: { path: "^packages/design-tokens/" },
      to: { pathNot: ["^packages/design-tokens/", npm("vitest")], dependencyTypesNot: ["core"] },
    },
    {
      name: "generated-ui-cannot-reach-trust-components",
      comment:
        "Generated UI (OpenUI) may ask and show, never commit: it cannot import the approval card, receipts or alerts, so it cannot render an Approve button.",
      severity: "error",
      from: { path: "^apps/web/features/generated-ui/" },
      to: { path: "^apps/web/features/trust/" },
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
      comment:
        "evals/ use packages/client and contracts. From src/ only the world adapter (seeding), the models " +
        "adapter (the simulated user's model) and the price table (its cost).",
      severity: "error",
      from: { path: "^evals/" },
      to: {
        path: ["^agent/", "^src/"],
        pathNot: ["^src/adapters/world/", "^src/adapters/models/", "^src/adapters/tracing/price-table\\.ts$", "^src/adapters/tracing/prices\\.json$"],
      },
    },
    {
      name: "only-the-approve-route-mints-grants",
      comment:
        "ApproveProposal is the only code that mints a grant, and the app API's approve route (a click on the card) is its " +
        "only caller. No agent tool, subagent or other use case may reach it, so model output can never become a grant.",
      severity: "error",
      from: { pathNot: ["^agent/channels/app-api\\.ts$", "^src/core/use-cases/approve-proposal\\.ts$", "\\.test\\.ts$"] },
      to: { path: "^src/core/use-cases/approve-proposal\\.ts$" },
    },
    {
      name: "nothing-imports-the-verification-tool",
      comment: "tools/verify drives the app from outside; no app, agent, package, eval or script may import it.",
      severity: "error",
      from: { pathNot: "^tools/verify/" },
      to: { path: "^tools/verify/" },
    },
    {
      name: "verification-reaches-the-app-through-the-browser-and-client",
      comment:
        "tools/verify reaches the app only through the browser (playwright-core) and packages/client (with the " +
        "contracts it parses); never src/, agent/, apps/, evals/ or scripts/.",
      severity: "error",
      from: { path: "^tools/verify/" },
      to: {
        path: ["^(src|agent|apps|evals|scripts)/", "^packages/"],
        pathNot: ["^packages/(client|contracts)/"],
      },
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
