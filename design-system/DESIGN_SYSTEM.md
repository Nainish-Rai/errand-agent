# Errand design system

**The source of truth is [`design-system-v3.html`](design-system-v3.html)**, Errand's design system rebased
on [Lime](https://design.how/systems/lime): a light system for consumer apps with one acid yellow-green
accent, a white page, warm-grey surfaces, near-black text and no blue. Open it in a browser: its change log
says what changed from v2 and why, its foundation tables are read live from the tokens, its "From v2 tokens
to Lime" table maps every v2 token, and each Errand pattern is a working screen. v2
([`design-system-v2.html`](design-system-v2.html)) is kept for comparison only. This file says how the app
follows v3; where the two disagree, v3 wins.

## Principles

1. **Lime's foundations, verbatim.** Colour, type, spacing, radius, elevation and motion are Lime's tokens.
   Errand adds three aliases (`--errand-ok-fill`, `--errand-on-ok-fill`, `--errand-inferred-edge`), two
   streaming durations (`--dur-stream-word`, `--dur-stream-lag`) and two dark contrast fixes, and nothing else.
2. **Light by default.** The app opens light whatever the OS prefers; dark is behind the toggle.
3. **One lime action per view.** The primary action is Lime's glowing lime (`glow glow-accent`); Approve is
   that action whenever an approval card shows. Lime is never a page, card or section background.
4. **One typeface.** Hanken Grotesk at 400, 500 and 600 (no 700). Figures are tabular Hanken; mono is only for
   codes (booking IDs, keys, tool names). No uppercase, no letter spacing except `--tracking-tight` on
   `text-xl` and up, no eyebrow labels.
5. **Colour carries meaning, never decoration.** Status keeps three hues (success, warn, danger), each with a
   mark, a tint and a text step. There is no info hue and no category hue. No gradient but the glow.
6. **Trust surfaces look different on purpose.** The approval card, booking receipt and alerts are fixed
   components. Generated UI never copies their look, and it has no Approve button.
7. **Inferred things are dashed** in `--errand-inferred-edge`, so a guess never looks like a fact.
8. **Missing data says so.** It reads "not available" or "checking…", never `0` or a blank.
9. **Motion is short and only on change.** `--ease-out` to arrive, `--ease-in` to leave, popups from
   `--scale-enter`, pressed controls to `--scale-press`. The spinner is the only loop. Reduced motion zeroes
   every duration but the spinner's.

## Tokens (`packages/design-tokens`)

The typed source is `packages/design-tokens/src`: `lime.ts` holds Lime's tokens copied from v3's lime source
block (light roles, dark roles, scale), and `errand.ts` holds Errand's additions and the two dark fixes. A test
(`tokens.test.ts`) reads v3 and fails if any value differs. `pnpm tokens:build` writes
`packages/design-tokens/tokens.css`, the only token file the web app imports (`@errand/design-tokens/tokens.css`);
never edit it by hand, `pnpm check:tokens` fails when it is stale. The package also exports `tokens.light`
and `tokens.dark` (every role resolved to a value, for clients that cannot read CSS) and `motion` (the
durations in ms and the curves as numbers, for script animation such as `motion/react`).

Every role that is a `var()` is declared on `:root`, `[data-theme="light"]` and `[data-theme="dark"]`, so a
panel can force either theme inside the other (the `/design` route does). Lime's base, glow and
forced-colors rules are vendored verbatim in `apps/web/app/lime.css`; `<html>` carries `class="lime"`. Lime's scope
rule gives its element `--text-sm`, which on `<html>` would make 1rem 14px and shrink Tailwind's rem-based spacing, so
`globals.css` keeps the root at the browser's size and sets body text to `--text-sm`.

| Group | Tokens |
|---|---|
| Surfaces | `--page`, `--surface`, `--surface-2`, `--surface-3`, `--raised`, `--field`, `--scrim` |
| Text | `--fg`, `--fg-2`, `--fg-3`, `--fg-disabled`, `--fg-inverse`, `--on-accent` |
| Lines | `--line`, `--line-strong`, `--control` |
| Ink | `--ink`, `--ink-hover`, `--ink-active` |
| Accent | `--accent`, `--accent-hover`, `--accent-active`, `--accent-wash`, `--accent-line`, `--ring` |
| Status | `--success`, `--warn`, `--danger` with `-tint` and `-text`; `--danger-hover`, `--on-danger` |
| Elevation | `--shadow-card`, `--shadow-menu`, `--shadow-overlay`, `--shadow-thumb` (overlays and raised cards only) |
| Glow | `--glow-accent-*`, `--glow-danger-*`, `--glow-success-*`, read only through the `.glow` classes |
| Type | `--font-sans` (Hanken Grotesk), `--font-mono` (system mono), `--text-xs 12` … `--text-3xl 36`, `--leading-*`, `--tracking-tight`, `--weight-normal/medium/semibold` |
| Size and radius | `--control-sm/md/lg`; `--radius-sm 6`, `--radius-md 10`, `--radius-field 12`, `--radius-panel 16`, `--radius-sheet 24`, `--radius-control` (pill) |
| Motion | `--dur-instant 80`, `--dur-fast 140`, `--dur-base 200`, `--dur-slow 280`, `--dur-spin 900`, `--ease-out`, `--ease-in`, `--scale-enter`, `--scale-press`; Errand's `--dur-stream-word 240`, `--dur-stream-lag 400` |
| Layers and layout | `--z-dialog/popover/toast`, `--overlay-sm/-/lg`, `--popover`, `--sheet`, `--popup-max`, `--focus-offset`, `--line-focus` |
| Errand | `--errand-ok-fill`, `--errand-on-ok-fill`, `--errand-inferred-edge` |

Components read these through Tailwind classes named after the roles (`bg-surface-2`, `text-fg-3`,
`border-line`, `text-danger-text`, `rounded-panel`, `shadow-menu`, `text-sm`, `duration-(--dur-base)`,
`ease-out`). The stock Tailwind palette, shadows, type scale, radii, tracking and animations are reset, so a
stock class Lime has no token for generates nothing. The only other colour names are seven shadcn names and
`red-*`, mapped in `globals.css` for streamdown's compiled classes; our own code never uses them.

**Theme switching:** `data-theme="light" | "dark"` on `<html>`. The server renders `light`, so the first
frame is light whatever the OS prefers. The toggle saves a dark choice in `localStorage` (`errand-theme`) and
a head script applies it before the first frame; switching back to light forgets it. v3's catalogue page does
not remember the toggle; the app does, because a person who picks dark should not have to pick it again, and
it never reads `prefers-color-scheme`, so light stays the default.

## One token source for every library and device

| Consumer | How it gets the tokens |
|---|---|
| Our components and the vendored shadcn ui (`apps/web/components/ui`) | Tailwind classes on the Lime roles |
| agents-ui (`apps/web/components/agents`) | The same classes; its springs, shimmer, sweep, shake, breathing spinner and overshoot are removed, and its script motion reads `motion` from the tokens package |
| streamdown | Its compiled shadcn class names, mapped to Lime roles in `globals.css` |
| OpenUI | `createTheme(...)` built from the Lime roles in `features/generated-ui/openui-theme.ts`, with `mode` following `data-theme` |
| Mobile (later) | `tokens.light` / `tokens.dark` and `motion` from `@errand/design-tokens` |

## Components

Each component has one source; every interactive one has default, hover, focus-visible, disabled and
loading states. v3 rebuilds the chat patterns on Lime components (ApprovalRequest, ToolCall, ActionReceipt,
FollowUps, List, Field, Empty, ErrorState); the app moves to them in tickets 21–23. Until then the app's
components below wear the Lime tokens.

| Component | Source | Notes |
|---|---|---|
| Button | shadcn | primary and default are the lime glow; secondary on `--surface-2`; ghost; outline; danger on the danger tint; pills |
| Chip | custom | filter chip (selected on `--accent-wash` with the olive line), suggestion chip (dashed pill), memory chip (explicit solid, inferred dashed) |
| Badge | custom | count (warn tint), alert (danger fill), tag, verified, inferred; pills |
| Status mark | custom | a mark beside a word, never colour alone |
| Spinner | custom / agents-ui | a quarter arc turning once per `--dur-spin`, the only loop |
| Skeleton | custom | still, on `--surface-2` |
| Tabs and segmented control | Radix | underline tabs; the selected segment is raised |
| Tooltip, toast | shadcn / agents-ui | ink (`--ink`, `--fg-inverse`) |
| Popover, menu, select, dialog | shadcn (Radix), agents-ui | `--raised`, `--radius-panel` (dialogs `--radius-sheet`), `--shadow-menu` / `--shadow-overlay`, enter from `--scale-enter` |
| Fields | shadcn | `--field` fill, `--line-strong` edge, `--radius-field`, Lime's focus ring |
| Monogram | custom | a provider's initials on `--surface`, the fallback where a photo is missing |
| Widget, mini bar chart | custom | `--surface` panel; bars in ink |
| Trace waterfall | agents-ui | operator console only: no glow, no hue, bars in ink steps, waiting dashed |
| Fixed trust components | custom | approval card, booking receipt, verification banner, provider-cancelled alert, memory fact row, inferred-fact prompt (`apps/web/features/trust`) |

The `/design` route renders the foundations and trust components from the real code in both themes side by
side.

## Rules and checks

- Components read Lime roles only. A new colour means a new token in v3 first, then in
  `packages/design-tokens/src`.
- `pnpm check:tokens` (in `pnpm check`) first checks `tokens.css` is current, then runs
  `python3 -I design-system/check_tokens.py --lime` over the generated tokens, every CSS, TS and TSX file
  under `apps/web/{app,components,features,lib}`, and v3 itself. Outside the vendored regions (Lime's source
  in `tokens.css`, `lime.css` and v3) it flags: a raw colour or stock Tailwind colour; a 700 weight; uppercase
  or letter spacing; a gradient; a literal duration, delay or curve, a spring or a loop other than the
  spinner; scroll reveal; `transition-all`; a shadow other than Lime's; a literal font size or radius, or a
  stock size Lime has no token for; a v2 or shadcn role name; an undefined `var()`. In CSS it also flags an
  em dash, an emoji and padding off the 4px scale. Shown failing on a planted line (17 findings) and on a
  planted CSS rule (6), and passing (0) on the current code.
- `pnpm check:contrast` runs `python3 -I design-system/check_contrast.py` over `tokens.css` and over v3. It
  resolves every role in both themes and checks 134 pairs: six text roles on three surfaces, every filled
  pair, the text on every stop of the accent, danger and success glows (rest, lit and pressed, both ends) at
  4.5:1, and the control outline, status marks, focus ring, booked mark and inferred edge at 3:1. Shown
  failing on 2 pairs without Errand's two dark fixes (dark `--danger-hover` 4.06:1, the pressed danger glow
  top 4.26:1) and passing 134 of 134 with them.
- `packages/design-tokens/src/tokens.test.ts` (in `pnpm check:tests`) pins the typed tokens to v3 value for
  value, checks every role resolves in both themes, and checks reduced motion zeroes every duration but
  `--dur-spin` and `--dur-stream-lag`.
