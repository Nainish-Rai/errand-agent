# Three bugs

Three real bugs from this repo's history. Each one has the fix that closed it and the regression test that guards it. All three tests were run on this branch and pass:

```bash
npx vitest run apps/web/features/generated-ui/openui-theme.test.ts src/core/use-cases/memory-use-cases.test.ts tools/verify/src/control-errand.test.ts \
  -t "reads on foreground|counts a remembered value the model passes on|accepts every seed suite" --reporter verbose
```

```
 ✓ apps/web/features/generated-ui/openui-theme.test.ts > OpenUI theme mapping > textNeutralPrimary reads on foreground in light (at least 4.5:1)
 ✓ apps/web/features/generated-ui/openui-theme.test.ts > OpenUI theme mapping > textNeutralSecondary reads on foreground in light (at least 4.5:1)
 ✓ apps/web/features/generated-ui/openui-theme.test.ts > OpenUI theme mapping > textNeutralPrimary reads on foreground in dark (at least 4.5:1)
 ✓ apps/web/features/generated-ui/openui-theme.test.ts > OpenUI theme mapping > textNeutralSecondary reads on foreground in dark (at least 4.5:1)
 ✓ src/core/use-cases/memory-use-cases.test.ts > prefilling the errand from memory > counts a remembered value the model passes on as memory, but not one the person said
 ✓ tools/verify/src/control-errand.test.ts > suite manifests > accepts every seed suite
 Test Files  3 passed (3)
```

## 1. The chart tooltip was black text on a black card

- **What broke.** In light mode, hovering a generated-UI chart (price, free slots, spend) showed a tooltip with black text on a black card. It couldn't be read.
- **Why.** OpenUI's theme has a role called `foreground`. Despite the name, it is a *surface*: tooltips, cards, menus and the ring around chart dots draw on it. We had mapped it to the ink colour (`fg`), so OpenUI drew its dark text on a dark fill. No check compared OpenUI's surfaces with its text roles.
- **Fix.** `foreground` now maps to the `raised` surface (`apps/web/features/generated-ui/openui-theme.ts`, with a comment saying why). PR [#24](https://github.com/Nainish-Rai/errand-agent/pull/24), commit `a318c33`.
- **Regression test.** `apps/web/features/generated-ui/openui-theme.test.ts`, `OpenUI theme mapping > <text> reads on <surface> in <mode> (at least 4.5:1)`. It checks every mapped OpenUI surface (`background`, `foreground`, `popoverBackground`, `elevated`, `elevatedStrong`, `sunk`) against both text roles in both themes: 24 cases. PR #24 planted the old mapping (`foreground: role("fg")`) and saw 4 cases fail, starting with `textNeutralPrimary reads on foreground in light`.

## 2. A remembered area was ignored when the model repeated it

- **What broke.** In the first live run of the memory scenarios (MiniMax-M3), only 1 of 4 passed. The person had a remembered area, Koramangala, and the new session should have used it and said so ("Using your usual area, Koramangala."). Instead, the errand got the area with no memory notice and no `memory → errand` trace event. The offline scripted model never showed this.
- **Why.** The prefill skipped every field the model's own `update_errand` call already set, on the theory that the person had just said it. MiniMax read the area from the "Remembered about this person" context and passed it on itself. So the value came from memory, but the prefill counted it as the person's words.
- **Fix.** `prefillErrandFromMemory` (`src/core/use-cases/prefill-errand-from-memory.ts`) counts a remembered value the model passes on as memory, unless the person said that value in this session. It checks the person's own messages (`personsWords`), not the model's arguments. PR [#12](https://github.com/Nainish-Rai/errand-agent/pull/12), commit `87d70e0`.
- **Regression test.** `src/core/use-cases/memory-use-cases.test.ts`, `prefilling the errand from memory > counts a remembered value the model passes on as memory, but not one the person said`. The model passes `hsr layout` while the person only asked for a plumber, so the test expects `["area"]` and the `memory → errand: area` event. When the person said "a plumber in HSR Layout", it expects `nothing_to_use`. PR #12's plant 6 restored the old rule and the test failed (`expected 'nothing_to_use' to deeply equal [ 'area' ]`).

## 3. `pnpm check` failed on main after a new browser suite

- **What broke.** After PR #24 merged, `pnpm check` failed on `main`. Every branch cut from it started red.
- **Why.** PR #24 added `verification/suites/focus-shells.json`, but it didn't add the file to the seed-suite manifest that `control-errand`'s test pins. The test fails on any suite file the list doesn't name, because an unlisted suite was never validated against the suite schema.- **Fix.** The manifest lists `focus-shells.json` (and each later suite: `lime-chat.json`, `home-memory-ops.json`). PR [#25](https://github.com/Nainish-Rai/errand-agent/pull/25), commit `8a82698`; PR [#27](https://github.com/Nainish-Rai/errand-agent/pull/27) also lists it.
- **Regression test.** `tools/verify/src/control-errand.test.ts`, `suite manifests > accepts every seed suite`. It reads `verification/suites/`, requires the exact sorted list, and runs `validateSuite` on every file. So a suite that's added but not listed, or that's malformed, fails `pnpm check` in the PR that adds it.
