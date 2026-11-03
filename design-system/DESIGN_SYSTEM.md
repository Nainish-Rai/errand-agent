# Errand design system

The look comes from the home mock (`mockups/home.html`): dark and dense, with a light theme. The token
structure is copied from [observatory-ui](https://github.com/Nainish-Rai/observatory-ui) (MIT, our own),
and its `check_tokens.py` comes along with it. One set of tokens themes every UI library in the app:
shadcn, assistant-ui, agents-ui and OpenUI. The mobile app reads the same tokens.

## Principles

1. **Hierarchy comes from surfaces and hairlines.** There are four surface steps: well, canvas, card and
   raised. Edges are 1px. Shadows are used only for things that float, such as popovers, toasts and the
   composer over the hero.
2. **Words are set in Geist; numbers, times and IDs in Geist Mono** with tabular figures (`₹899`, `09:00`, `0:42`).
3. **Colour carries meaning, never decoration.**
   - `ok` means confirmed or verified.
   - `warn` means it needs you, or is inferred.
   - `err` means cancelled or failed.
   - `info` and `interactive` mean in progress or focus.
   - `brand` (orange) is used only for the logo and the illustration.
4. **Trust surfaces look different on purpose.** The approval card, booking receipt and alerts are fixed
   components with their own layout. Generated UI never copies their look, and it has no Approve button.
5. **Inferred things are dashed.** An inferred memory fact, an estimated cost or a heuristic score uses a
   dashed edge in the `warn` tone, so a user can always tell a guess from a fact.
6. **Missing data says so.** It reads "not available" or "checking…", never `0` or a blank.
7. **Motion runs once and on purpose.** Every duration is a token and is zeroed under reduced motion.
8. **Accessible in both themes.** Every text role is at least 4.5:1 against card and canvas in both themes;
   the measured values are below. The focus ring is always visible, and touch targets are at least 32px
   (44px on mobile).

## Tokens (`packages/design-tokens`)

The source is the typed object in `packages/design-tokens/src` (primitives, then the dark and light roles,
then the bridge, then type and motion). `pnpm tokens:build` generates `packages/design-tokens/tokens.css`
from it and rebuilds the inlined gallery; the web app imports only that generated file
(`@errand/design-tokens/tokens.css`). Never edit `tokens.css` by hand: `pnpm check:tokens` fails when it
is stale. The roles and the bridge are declared on `:root`, `[data-theme="dark"]` and `[data-theme="light"]`,
so a panel can force either theme inside the other.

| Group | Tokens | Notes |
|---|---|---|
| Primitives | `--ink-0…9`, `--paper-0…8`, `--blue/green/amber/red/orange-{bright,deep}`, `--cat-1…6`, `--night-*`, `--day-*` | The only literal colours in the repo (enforced by the checker) |
| Surfaces | `--surface-well`, `--surface-canvas`, `--surface-card`, `--surface-raised`, `--surface-glass` | |
| Edges | `--edge`, `--edge-strong`, `--edge-glass` | |
| Text | `--fg-emph`, `--fg-body`, `--fg-meta`, `--fg-faint` | `fg-faint` is only for icons and dividers, never text |
| Tones | `--ok`, `--warn`, `--err`, `--info`, `--interactive`, each with a `-tint`; `--warn-fill`, `--err-fill` with `--on-*-fill` | |
| Brand and hero | `--brand`, `--hero-*` | The hero swaps night for day by theme |
| Type | `--font-sans`, `--font-mono`, `--text-meta 10`, `--text-label 11`, `--text-body 12`, `--text-panel 14`, `--text-title 19`, `--text-kpi 22`, `--weight-*` | |
| Space and radius | `--space-1…8` (4px grid), `--radius-1 4`, `--radius-2 6`, `--radius-3 10`, `--radius-pill` | |
| Motion | `--ease-out`, `--ease-sheet`, `--dur-micro/collapse/exit/enter/theme/draw/spin` | All zeroed under `prefers-reduced-motion` |
| Library bridge | `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--border`, `--ring`, `--radius`, `--chart-1…5` | shadcn names, mapped from semantic roles |

Measured contrast with `check_contrast.py`, on card, with the lowest surface (raised) in brackets:

| Theme | emph | body | meta | interactive | ok | warn | err | warn badge | err badge |
|---|---|---|---|---|---|---|---|---|---|
| Dark | 13.3 (12.0) | 8.6 (7.8) | 5.1 (4.6) | 5.0 (4.6) | 6.4 (5.8) | 6.4 (5.8) | 5.4 (4.9) | 7.5 | 5.4 |
| Light | 15.5 (14.5) | 9.7 (9.1) | 5.3 (5.0) | 5.3 (5.0) | 5.4 (5.1) | 5.3 (4.9) | 5.0 (4.7) | 7.5 | 5.4 |

**Theme switching:** `data-theme="light" | "dark"` on `<html>`. The default follows the system
setting; the user's choice is saved.

## One token source for every library and device

| Consumer | How it gets the tokens |
|---|---|
| eve chat template (shadcn, Tailwind v4) | The bridge variables. The template's `@theme inline` maps `--color-*` onto them, so its components restyle without code changes |
| assistant-ui | Reads the same shadcn variables |
| agents-ui | shadcn-style components, so they read the same variables. Its typeface (Hanken Grotesk) is replaced by `--font-sans` |
| OpenUI | `createTheme(...)` built from the semantic roles in one small mapping module, with `mode` following `data-theme` |
| Mobile (later) | `packages/design-tokens` exports the same values as a typed object (`tokens.dark`, `tokens.light`), which NativeWind or StyleSheet uses directly. `tokens.css` is generated from that object |

## Components

Each component has one source. Every interactive component has default, hover, focus-visible, disabled
and loading states.

### Foundations

| Component | Source | Variants |
|---|---|---|
| Button | shadcn | primary (`--primary` fill), secondary, ghost, danger; sm and md |
| Icon button | shadcn | with badge |
| Chip | custom | filter chip (with ⌄ menu), suggestion chip (dashed pill), memory chip (explicit solid, inferred dashed) |
| Badge | custom | count (`warn-fill`), alert (`err-fill`), tag (outline) |
| Status mark | custom | ✓ ok, ◌ checking, ↻ replacing, ✕ cancelled, ● needs you, each with a text label as well, never colour alone |
| Spinner, Skeleton | custom / shadcn | |
| Tabs and segmented control | shadcn | composer tabs |
| Tooltip, Popover, Menu, Select | shadcn (Radix) | |
| Kbd | agents-ui primitive | `⌘K` |
| Avatar and monogram | custom | initials monograms for providers (no photos of people) |
| Toast | shadcn (sonner) | ok, err, info |
| Empty state | custom | one line plus one action |
| Mini bar chart | custom (CSS) | widgets; OpenUI charts inside chat |

### App shell

| Component | Notes |
|---|---|
| Top bar | home switcher with count, search `⌘K`, theme toggle, notification bell |
| Hero | SVG skyline with night and day themes from `--hero-*`; headline uses `--text-title` |
| Composer | tabs (New errand / Running N), input, chips for area, budget, time and model, send button |
| Widget | header (icon, title, count, optional action), body, compact rows. The base for every home widget |
| Widget grid | 2 columns, 1 column below 560px |
| Bottom tab bar | mobile only |

### Home widgets (built on Widget)

Working now · Waiting on you · Upcoming bookings · Alerts · Bookings activity · Memory

### Chat

| Component | Source |
|---|---|
| Thread, message, composer, scroller | assistant-ui with agents-ui `message`, `message-scroller`, `chat-input` |
| Agent progress | agents-ui `task-list` and `reasoning-steps`, showing steps such as "comparing 5 providers" |
| Status line | custom: "Checking with the provider…" while verifying |

### Fixed trust components (custom; never generated)

| Component | States |
|---|---|
| Approval card | variants for book (provider, job, time in IST, price, address, cancellation terms), cancel (shows the fee) and reschedule (old time beside new). States: pending, approving, approved, voided ("price changed ₹899 → ₹1,050"), expired, declined (the hold was released). Material details sit in a fixed key–value table. Actions are Approve (with the price on the button), Other options and Decline. *Approve* is used only here; *confirm* is only for inferred facts |
| Booking receipt | verified booking ID (mono), provider, slot and price. States: booked, checking, failed |
| Verification banner | "Checking with the provider…" with a promised update |
| Provider-cancelled alert | the cancelled booking, "N replacements ready" and See options |
| Memory fact row | explicit or inferred badge, source, Correct and Forget actions; a forgotten fact shows a tombstone line |
| Inferred-fact prompt | "Prefers mornings?" with Yes and No |

### Generated components (OpenUI library, themed by tokens)

| Component | Data binding |
|---|---|
| Provider choice card (row of up to 3, carousel beyond) | provider ID: photo, tag, name, rating, price and earliest slot come from the API; the reason comes from the model. Buttons are **Choose** and **Details** |
| Provider details | provider ID: gallery and review-insight tags |
| Review insight card | review-reader schema output |
| Slot picker | provider ID and week: slots from the API |
| Pick-one list | booking or slot IDs |
| Ask form | only the missing errand fields (chips, slider, date) |
| Charts: price, availability, spend | IDs or a query; values from the API |
| Follow-up chips | the model's suggestions |

### Observability

| Component | Source |
|---|---|
| Trace waterfall | agents-ui `trace-waterfall` |
| Context log panel | custom: per turn, the facts included and excluded with reasons |
| Trace side panel | custom layout: chat on the left, trace on the right; collapses to a sheet on mobile |

## Rules and checks

- Components read semantic roles only. A new colour means a new semantic role in `packages/design-tokens/src/roles.ts` first.
- `python3 -I design-system/check_tokens.py [--tokens packages/design-tokens/tokens.css] <files>` flags literal
  colours outside primitives, undefined tokens, fixed durations and a missing reduced-motion block. `--tokens`
  lets an app stylesheet use the variables the token file defines. `pnpm check:tokens` runs it over the
  generated tokens, every CSS file under `apps/` and the inlined gallery, after checking the generated file
  is current. It runs in `pnpm check`. It was shown failing
  (52 findings when the primitive markers were wrong) and passing (0 findings) on the current tokens.
- `python3 -I design-system/check_contrast.py packages/design-tokens/tokens.css` (`pnpm check:contrast`) resolves every role to its hex in both themes and
  checks 48 pairs: 7 text roles on 3 surfaces, plus the filled badges and the primary button. It fails below
  4.5:1 and runs in `pnpm check`. Its first run failed on 4 pairs: the dark error badge was 3.35, dark `err`
  on raised was 4.36, and light `ok` and `warn` on raised were 4.45 and 4.46. Those primitives were adjusted
  and it now passes 48 of 48.
- The gallery source is `design-system/gallery.html`, which links the generated `tokens.css`.
  `python3 -I design-system/build_gallery.py design-system/gallery.html packages/design-tokens/tokens.css mockups/design-system.html`
  inlines the tokens into one file that the checker can scan. Every component is shown in both themes.
  In the app it is the `/design` route, built from the real components.
