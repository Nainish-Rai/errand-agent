import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `pnpm verify:install-skill`: links ~/.claude/skills/verify-errand to the skill in the repo's main
// checkout, so the link outlives any worktree it was installed from. It replaces an older link but
// never a real file or directory.

export const SKILL_NAME = "verify-errand";
const SKILL_PATH = path.join(".claude", "skills", SKILL_NAME);

/** The main working tree of the repo that holds `directory` (the first `git worktree list` entry). */
export function mainCheckout(directory: string): string {
  const listing = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: directory, encoding: "utf8" });
  const first = listing.split("\n").find((line) => line.startsWith("worktree "));
  if (first === undefined) throw new Error(`${directory} is not in a Git checkout`);
  return first.slice("worktree ".length).trim();
}

export interface LinkResult {
  readonly ok: boolean;
  readonly link: string;
  readonly target: string;
  readonly replacedLink?: string;
  /** False when the target does not exist yet, e.g. before the skill is merged into the main checkout. */
  readonly resolves: boolean;
}

export function linkSkill({ source, skillsDirectory }: { readonly source: string; readonly skillsDirectory: string }): LinkResult {
  const link = path.join(skillsDirectory, SKILL_NAME);
  fs.mkdirSync(skillsDirectory, { recursive: true });
  let replacedLink: string | undefined;
  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(link);
  } catch {
    existing = undefined;
  }
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) throw new Error(`${link} exists and is not a symbolic link; move it away yourself, then rerun`);
    replacedLink = fs.readlinkSync(link);
    fs.unlinkSync(link);
  }
  fs.symlinkSync(source, link, "dir");
  return { ok: true, link, target: source, ...(replacedLink === undefined ? {} : { replacedLink }), resolves: fs.existsSync(link) };
}

export function installSkill(argv: readonly string[]): LinkResult {
  const sourceFlag = argv.indexOf("--source");
  const requested = sourceFlag >= 0 ? argv[sourceFlag + 1] : undefined;
  const source = requested === undefined ? path.join(mainCheckout(process.cwd()), SKILL_PATH) : path.resolve(requested);
  return linkSkill({ source, skillsDirectory: path.join(os.homedir(), ".claude", "skills") });
}
