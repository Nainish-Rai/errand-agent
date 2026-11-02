import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// What exactly is being verified: the checkout, its branch and revision, and a digest of every
// uncommitted change the snapshot would copy. A changed digest after launch means relaunch.

export interface SourceIdentity {
  readonly checkout: string;
  readonly branch: string | null;
  readonly revision: string;
  readonly sourceDigest: string;
}

/** Never copied into a snapshot, so changes there cannot affect a run. */
export const NOT_SNAPSHOTTED = /^(\.git|\.scratch|\.eve|traces|\.env[^/]*|\.DS_Store)(\/|$)|(^|\/)\.next(\/|$)/;

function git(checkout: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: checkout, encoding: "utf8", maxBuffer: 200e6, stdio: ["ignore", "pipe", "pipe"] });
}

/** --repo, then ERRAND_REPO, then the Git root of the working directory. */
export function resolveCheckout(requested: string | undefined): string {
  const start = path.resolve(requested ?? process.env.ERRAND_REPO ?? process.cwd());
  let root = start;
  try {
    root = git(start, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    // Not a Git checkout: validateCheckout says what is missing.
  }
  return fs.realpathSync(root);
}

export function validateCheckout(checkout: string): void {
  const required = ["agent/agent.ts", "apps/web/package.json", "packages/client/src/index.ts"];
  for (const file of required) {
    if (!fs.existsSync(path.join(checkout, file))) {
      throw new Error(`${checkout} is not an errand-agent checkout (missing ${file}); pass --repo or run from one`);
    }
  }
  for (const bin of ["node_modules/.bin/eve", "apps/web/node_modules/.bin/next"]) {
    if (!fs.existsSync(path.join(checkout, bin))) throw new Error(`Install the checkout's dependencies first: pnpm install in ${checkout} (missing ${bin})`);
  }
}

function untrackedFiles(checkout: string): string[] {
  return git(checkout, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter((file) => file !== "" && !NOT_SNAPSHOTTED.test(file))
    .sort();
}

/** Tracked diff plus untracked file names and contents: everything the snapshot copies beyond HEAD. */
export function sourceDigest(checkout: string): string {
  const digest = crypto.createHash("sha256");
  digest.update(execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: checkout, maxBuffer: 500e6 }));
  for (const file of untrackedFiles(checkout)) {
    digest.update("\0").update(file).update("\0");
    try {
      const stat = fs.lstatSync(path.join(checkout, file));
      if (stat.isFile() && stat.size <= 20e6) digest.update(fs.readFileSync(path.join(checkout, file)));
      else digest.update(`${stat.size}:${stat.mtimeMs}`);
    } catch {
      digest.update("missing");
    }
  }
  return digest.digest("hex");
}

export function sourceIdentity(checkout: string): SourceIdentity {
  let branch: string | null = null;
  try {
    branch = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    branch = null;
  }
  return { checkout, branch, revision: git(checkout, ["rev-parse", "HEAD"]).trim(), sourceDigest: sourceDigest(checkout) };
}
