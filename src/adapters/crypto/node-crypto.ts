import { createHash, randomBytes } from "node:crypto";

import type { Hasher } from "../../core/ports/hasher";
import type { IdSource } from "../../core/ports/id-source";

// Node's crypto behind core's ports: SHA-256 for fingerprints, random ids for proposals and grants.

export const sha256Hasher: Hasher = {
  sha256Hex: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
};

/** 96 random bits per id: nobody can guess a proposal or grant id, and two never collide in practice. */
export const randomIds: IdSource = {
  next: (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`,
};
