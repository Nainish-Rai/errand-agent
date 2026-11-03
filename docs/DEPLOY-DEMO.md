# Hosted demo (Vercel)

A demo build of `apps/web` runs with no backend, no model and no key: the same UI, answered in the browser
from a recording of the real backend. Set `NEXT_PUBLIC_ERRAND_DEMO=1` at build time and it deploys to Vercel
as a plain Next.js app. Without the variable the build is the normal app, with none of the demo in it.

## What the demo is

- **Scripted, not the agent.** The chat matches what you type against a few keywords and replays recorded
  turns of the real backend: the same eve messages and tool results, drawn by the same renderers. A banner
  on every screen says so and links the repo. The real agent, with a model, is what `pnpm dev` runs.
- **Recorded from the real core.** `pnpm demo:record` (`scripts/demo/`) starts the backend with the
  evals' scripted model, the pinned clock (Wed 4 Nov 2026, 09:00 IST) and the `timeout_after_success`
  world (seed 42). It drives every scripted turn through `@errand/client` and writes
  `apps/web/features/demo/recording.json` and `ops-recording.json`. `recording.test.ts` checks both files
  against the contracts in `pnpm check`. If the wire changes, record again.
- **The same rule.** Only Approve on the card books. A typed "yes" books nothing, and Decline books nothing.
  The booking runs through the recorded ledger steps ("Checking with the provider…") to a verified receipt.
- **State lives in the tab.** Holds, bookings and memory changes are kept in `sessionStorage`, so a reload
  keeps them. **Reset demo** in the banner starts over.
- **`/ops`** opens without a token in demo mode. It shows the committed trace
  (`docs/traces/timeout-after-success.jsonl`) and the recorded plumber chat, read through the backend's own
  presenters.

Try: the "Plumber for a leaking kitchen tap this week" pill, Choose, Approve; "Compare their prices for me";
"yes" before approving; "She needs her AC repaired too, at my mom's place in HSR Layout" after booking;
"I need a plumber in Koramangala" from home (the ask form); Memory → Confirm / Correct / Forget.

## Deploy from the Vercel dashboard

1. **Add New… → Project → Import** the `errand-agent` GitHub repository.
2. **Root Directory:** `apps/web`. Leave **Include files outside the root directory in the Build Step**
   on: the app builds the workspace packages from source.
3. **Framework Preset:** Next.js.
4. **Build and Output Settings** (override both):
   - Install Command: `cd ../.. && pnpm install --frozen-lockfile --filter "@errand/web..."`
   - Build Command: `pnpm build`
   - Output Directory: leave the default.
5. **Environment Variables** (Production and Preview):
   - `NEXT_PUBLIC_ERRAND_DEMO` = `1`
   - `ENABLE_EXPERIMENTAL_COREPACK` = `1`: Vercel then uses the repo's `packageManager` (pnpm 10.30.2),
     which the workspace's `allowBuilds` setting needs.
6. **Deploy.** Node comes from `engines` (`>=24`). If the project shows a Node.js version setting, pick 24.x.

No secrets: the demo reads no key and calls nothing. `NEXT_PUBLIC_BACKEND_URL` is not used in demo mode.
No `vercel.json` is needed.

The install command installs only the web app and the workspace packages it uses (`@errand/client`,
`@errand/contracts`, `@errand/design-tokens`), not the backend, evals or verify tools.

## Deploy with the Vercel CLI

From the repository root, with the CLI installed and logged in (`pnpm dlx vercel login`):

```bash
pnpm dlx vercel link                       # create or pick the project
# then set Root Directory, Install and Build commands as above, in Project Settings → Build and Deployment
pnpm dlx vercel env add NEXT_PUBLIC_ERRAND_DEMO production    # value: 1
pnpm dlx vercel env add ENABLE_EXPERIMENTAL_COREPACK production # value: 1
pnpm dlx vercel deploy --prod
```

## Check it locally first

The same install and build Vercel runs, from a fresh clone:

```bash
cd apps/web
(cd ../.. && pnpm install --frozen-lockfile --filter "@errand/web...")
NEXT_PUBLIC_ERRAND_DEMO=1 pnpm build
pnpm exec next start -p 3311          # http://localhost:3311
```

Only the demo's own origin is requested: no `localhost:3100`, no model, no third party.
