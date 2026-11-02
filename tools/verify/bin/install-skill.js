#!/usr/bin/env node
// pnpm verify:install-skill [-- --source PATH]: link ~/.claude/skills/verify-errand to the repo's skill.
import { register } from "tsx/esm/api";

register();
const { installSkill } = await import("../src/skill-link.ts");
try {
  console.log(JSON.stringify(installSkill(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
