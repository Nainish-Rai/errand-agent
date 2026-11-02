# 18: Design system foundation: tokens, themes and the component kit in the app

**What to build:** The web app looks and behaves like the gallery in both themes. The shared tokens become the single source for every UI library. The eve template's shadcn components, assistant-ui, agents-ui and OpenUI all restyle from them with no per-component colours. The user's theme follows the system setting until they toggle it, and the choice persists. The foundation components (buttons, chips, badges, status marks, tabs, toast, skeleton, empty state, widget, list row) and the fixed trust components (approval card, booking receipt, verification banner, provider-cancelled alert, memory fact row) exist with every state shown in the design-system doc. A `/design` route renders all of them in both themes, so later tickets reuse them instead of styling their own.

**Blocked by:** 01

**Status:** done (PR #3)

- [x] The tokens live in a design-tokens package as a typed object (dark and light); the CSS variables are generated from it, and the web app imports only the generated CSS
- [x] The token check runs in `pnpm check` over the tokens and every app stylesheet, and passes. It is shown failing once on a planted literal colour
- [x] The contrast check runs in `pnpm check`: every text role on canvas, card and raised, plus the badge fills and primary button, is at least 4.5:1 in both themes. It is shown failing once on a planted low-contrast token
- [ ] The shadcn bridge drives the eve template, assistant-ui and agents-ui; OpenUI's theme is built from the same semantic roles, and its mode follows `data-theme`
- [x] The approval card renders pending, approving, approved, voided (old price beside new) and expired states; its button reads "Approve ₹<price>", and generated UI has no component that can render an Approve button
- [x] Inferred facts, estimates and heuristic scores use the dashed warn style everywhere; explicit facts never do
- [x] Status is never shown by colour alone: every status mark carries a text label
- [ ] Theme: system default, toggle persists across reloads, no flash of the wrong theme on load, and every duration is zeroed under reduced motion
- [x] `/design` screenshots in dark and light are attached to the ticket

**Notes (PR #3):**

- Screenshots: [dark](../../../docs/evidence/18-design-dark.png), [light](../../../docs/evidence/18-design-light.png).
- Tokens: the web app imports only `@errand/design-tokens/tokens.css` at runtime; `features/generated-ui/openui-theme.ts` imports the `SemanticRole` type only.
- Approve button: generated UI cannot render one because `features/generated-ui` may not import `features/trust` (the `generated-ui-cannot-reach-trust-components` layer rule, shown failing on a planted import). No generated UI exists yet; ticket 17 builds it.
- Left open: the shadcn bridge drives the template, assistant-ui and agents-ui, but OpenUI is not installed. `buildOpenUiTheme()` and `openUiMode()` exist for ticket 17 to wire into OpenUI's `ThemeProvider`.
- Left open: system default, saved toggle and no flash are verified in headless Chrome, and every token duration and Tailwind's default motion are zeroed under reduced motion. The vendored agents-ui components (trace waterfall, spinner, tooltip) still use their own literal durations behind their own `motion-reduce` / `useReducedMotion` guards, so "every duration is zeroed" is not proven for them.
