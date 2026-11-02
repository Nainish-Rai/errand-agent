# 18: Design system foundation: tokens, themes and the component kit in the app

**What to build:** The web app looks and behaves like the gallery in both themes. The shared tokens become the single source for every UI library. The eve template's shadcn components, assistant-ui, agents-ui and OpenUI all restyle from them with no per-component colours. The user's theme follows the system setting until they toggle it, and the choice persists. The foundation components (buttons, chips, badges, status marks, tabs, toast, skeleton, empty state, widget, list row) and the fixed trust components (approval card, booking receipt, verification banner, provider-cancelled alert, memory fact row) exist with every state shown in the design-system doc. A `/design` route renders all of them in both themes, so later tickets reuse them instead of styling their own.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The tokens live in a design-tokens package as a typed object (dark and light); the CSS variables are generated from it, and the web app imports only the generated CSS
- [ ] The token check runs in `pnpm check` over the tokens and every app stylesheet, and passes. It is shown failing once on a planted literal colour
- [ ] The contrast check runs in `pnpm check`: every text role on canvas, card and raised, plus the badge fills and primary button, is at least 4.5:1 in both themes. It is shown failing once on a planted low-contrast token
- [ ] The shadcn bridge drives the eve template, assistant-ui and agents-ui; OpenUI's theme is built from the same semantic roles, and its mode follows `data-theme`
- [ ] The approval card renders pending, approving, approved, voided (old price beside new) and expired states; its button reads "Approve ₹<price>", and generated UI has no component that can render an Approve button
- [ ] Inferred facts, estimates and heuristic scores use the dashed warn style everywhere; explicit facts never do
- [ ] Status is never shown by colour alone: every status mark carries a text label
- [ ] Theme: system default, toggle persists across reloads, no flash of the wrong theme on load, and every duration is zeroed under reduced motion
- [ ] `/design` screenshots in dark and light are attached to the ticket
