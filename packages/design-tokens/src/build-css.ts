// Writes packages/design-tokens/tokens.css from the typed tokens.
//   tsx packages/design-tokens/src/build-css.ts           write the file
//   tsx packages/design-tokens/src/build-css.ts --check   exit 1 if the committed file is stale
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderTokensCss } from "./css";

const target = fileURLToPath(new URL("../tokens.css", import.meta.url));
const css = renderTokensCss();

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // A missing file is stale too.
  }
  if (committed !== css) {
    console.error(`${target} is stale. Run \`pnpm tokens:build\` and commit the result.`);
    process.exit(1);
  }
  console.log("packages/design-tokens/tokens.css matches the typed tokens.");
} else {
  writeFileSync(target, css);
  console.log("wrote packages/design-tokens/tokens.css");
}
