import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Grant } from "../../core/approval/grant";
import type { Proposal } from "../../core/approval/proposal";
import { openDatabase } from "./database";
import { SqliteProposalStore } from "./sqlite-proposal-store";

function proposal(proposalId: string, sessionId = "ses_1"): Proposal {
  return {
    proposalId,
    sessionId,
    userId: "dev-user",
    fingerprint: `fp_${proposalId}`,
    status: "pending",
    createdAtMs: 1_000,
    terms: {
      action: "book",
      providerId: "prv_1",
      providerName: "Ravi Plumbing",
      service: "plumber",
      rating: 4.6,
      area: "Koramangala",
      cancellationTerms: "Free until 2 hours before.",
      slot: { start: "2026-11-05T09:00:00+05:30", end: "2026-11-05T10:00:00+05:30" },
      priceInr: 499,
      holdId: "hold_0001",
      holdExpiresAt: "2026-11-04T09:10:00.000Z",
    },
  };
}

function grant(grantId: string, proposalId: string): Grant {
  return { grantId, proposalId, fingerprint: `fp_${proposalId}`, userId: "dev-user", issuedAtMs: 2_000, expiresAtMs: 3_000 };
}

describe("sqlite proposal store", () => {
  it("keeps one grant per proposal: a second approval gets the first grant back", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    const first = await store.issueGrant(grant("grt_1", "prp_a"));
    const second = await store.issueGrant(grant("grt_2", "prp_a"));
    expect(first.grantId).toBe("grt_1");
    expect(second.grantId).toBe("grt_1");
  });

  it("lets a grant be consumed exactly once", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    await store.issueGrant(grant("grt_1", "prp_a"));
    expect(await store.consumeGrant("grt_1", 2_500)).toBe(true);
    expect(await store.consumeGrant("grt_1", 2_600)).toBe(false);
    expect((await store.grantOf("prp_a"))?.consumedAtMs).toBe(2_500);
    expect(await store.consumeGrant("grt_missing", 2_600)).toBe(false);
  });

  it("voids an unused grant once, and a voided grant can never be consumed", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    await store.issueGrant(grant("grt_1", "prp_a"));
    expect(await store.voidGrant("grt_1", 2_500)).toBe(true);
    expect(await store.voidGrant("grt_1", 2_600)).toBe(false);
    expect(await store.consumeGrant("grt_1", 2_700)).toBe(false);
    expect(await store.grantOf("prp_a")).toMatchObject({ voidedAtMs: 2_500 });
    expect((await store.grantOf("prp_a"))?.consumedAtMs).toBeUndefined();
  });

  it("can't void a grant that was already used", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    await store.issueGrant(grant("grt_1", "prp_a"));
    expect(await store.consumeGrant("grt_1", 2_500)).toBe(true);
    expect(await store.voidGrant("grt_1", 2_600)).toBe(false);
    expect((await store.grantOf("prp_a"))?.voidedAtMs).toBeUndefined();
  });

  it("keeps a voided proposal's changes and its replacement", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    const invalidation = { changes: [{ field: "price" as const, from: 499, to: 599 }], replacedBy: "prp_b", atMs: 2_500 };
    await store.saveProposal({ ...proposal("prp_a"), status: "voided", invalidation });
    expect(await store.findProposal("prp_a")).toMatchObject({ status: "voided", invalidation });
  });

  it("finds the session's latest proposal and the proposal behind a booking", async () => {
    const store = new SqliteProposalStore(openDatabase(":memory:"));
    await store.saveProposal(proposal("prp_a"));
    await store.saveProposal(proposal("prp_b"));
    await store.saveProposal(proposal("prp_other", "ses_2"));
    await store.saveProposal({ ...proposal("prp_a"), status: "executed", bookingId: "bkg_0002" });
    expect((await store.latestProposalOf("ses_1"))?.proposalId).toBe("prp_b");
    expect((await store.findProposalByBooking("bkg_0002"))?.proposalId).toBe("prp_a");
    expect((await store.listProposals({ userId: "dev-user", status: "pending" })).map((p) => p.proposalId)).toEqual([
      "prp_other",
      "prp_b",
    ]);
  });

  it("keeps proposals and grants across a reopen, so a restart loses no approval", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "errand-proposals-")), "errand.db");
    const first = new SqliteProposalStore(openDatabase(file));
    await first.saveProposal(proposal("prp_a"));
    await first.issueGrant(grant("grt_1", "prp_a"));
    const second = new SqliteProposalStore(openDatabase(file));
    expect(await second.findProposal("prp_a")).toEqual(proposal("prp_a"));
    expect((await second.grantOf("prp_a"))?.grantId).toBe("grt_1");
  });
});
