# 20: Lime foundations in the app: tokens, type, motion, light by default

**What to build:** The web app takes on design system v3 (`design-system/design-system-v3.html`, rebased on Lime). The design-tokens package carries Lime's roles and values, the three `--errand-*` additions and the two dark contrast fixes, all copied from v3. Hanken Grotesk replaces Geist. Every screen restyles at once: the existing semantic token classes are re-pointed at Lime roles first (expand), so nothing breaks; components then move to the Lime role names, and the old names go once nothing uses them (contract). Light is the default theme whatever the OS prefers; dark stays behind the toggle. Motion uses only Lime's tokens plus `--dur-stream-word` and `--dur-stream-lag`. The spring and overshoot curves, shimmer, the skeleton sweep, pulse loops and scroll reveal from v2 and agents-ui are removed. The spinner is the only loop.

**Blocked by:** None (can start immediately)

**Status:** done (PR #23)

- [x] The tokens package holds the Lime values for light and dark as its single source, plus the v3 additions; the generated CSS matches v3's token tables
- [x] The token check in `pnpm check` enforces the Lime rules that v3's `check_tokens.py --lime` enforces: no 700 weight, no uppercase or tracking, no gradient except the glow, no raw colour, duration, shadow, radius or font size, and no loop except the spinner. Show it failing once on a planted defect
- [x] The contrast check covers the Lime roles in both themes, including every glow stop, and passes
- [x] First load is light with OS dark emulated, and there is no flash; the toggle still switches to dark
- [x] Under reduced motion every duration except the spinner's is 0, including the vendored agents-ui components
- [x] Every screen (home, chat, memory, `/ops`, `/design`) renders in Lime with no leftover v2 colour, eyebrow label or uppercase text; screenshots before and after are attached
- [x] `design-system/DESIGN_SYSTEM.md` points to v3 as the source of truth
