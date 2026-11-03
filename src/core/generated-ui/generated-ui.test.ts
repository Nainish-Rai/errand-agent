import { describe, expect, it } from "vitest";

import type { GeneratedUiReading, UiNode } from "../ports/generated-ui-reader";
import { judgeAskedUi, judgePresentedUi, providerIdsIn } from "./generated-ui";
import { isCommitPhrase } from "./library-rules";

function read(nodes: UiNode[], foreign: string[] = []): GeneratedUiReading {
  return { kind: "read", nodes: [{ component: "Stack", props: {} }, ...nodes], foreign, warnings: [] };
}

const cards: UiNode[] = [
  { component: "ProviderChoices", props: {} },
  { component: "ProviderChoice", props: { providerId: "prv_1", highlight: "Same-day", reason: "Can come today" } },
];

describe("generated UI may ask and show, never commit", () => {
  it("draws choice cards from the library", () => {
    expect(judgePresentedUi(read(cards), [])).toEqual({ kind: "drawable", components: ["Stack", "ProviderChoices", "ProviderChoice"], warnings: [] });
  });

  it("falls back to text when the program didn't parse", () => {
    expect(judgePresentedUi({ kind: "unreadable", errors: ["no-root"] }, []).kind).toBe("unreadable");
  });

  it("refuses a component outside the library, such as an Approve button", () => {
    const verdict = judgePresentedUi(read([{ component: "ApproveButton", props: { label: "Approve ₹399" } }]), []);
    expect(verdict).toMatchObject({ kind: "refused", problems: [{ kind: "unknown_component", component: "ApproveButton" }] });
  });

  it("refuses any action, query or mutation the model wrote", () => {
    const verdict = judgePresentedUi(read(cards, ["Mutation book", "Comp ToAssistant"]), []);
    expect(verdict.kind === "refused" && verdict.problems.map((problem) => problem.kind)).toEqual(["action_not_allowed", "action_not_allowed"]);
  });

  it("refuses a chip that offers to approve, confirm or pay", () => {
    for (const text of ["Approve it", "Confirm booking", "Pay ₹399", "Go ahead"]) {
      const verdict = judgePresentedUi(read([{ component: "FollowUps", props: { suggestions: ["Show evening slots", text] } }]), []);
      expect(verdict).toMatchObject({ kind: "refused", problems: [{ kind: "commit_phrase", text }] });
    }
  });

  it("lets ordinary next steps through", () => {
    expect(isCommitPhrase("Book a cleaner too")).toBe(false);
    expect(isCommitPhrase("Show evening slots")).toBe(false);
  });

  it("refuses a component whose data isn't served yet", () => {
    const verdict = judgePresentedUi(read([{ component: "ReviewInsight", props: { providerId: "prv_1" } }]), []);
    expect(verdict).toMatchObject({ kind: "refused", problems: [{ kind: "pending_component", component: "ReviewInsight" }] });
  });

  it("keeps asking out of present and showing-only out of ask", () => {
    expect(judgePresentedUi(read([{ component: "AskForm", props: { fields: ["area"] } }]), [])).toMatchObject({
      kind: "refused",
      problems: [{ kind: "ask_in_present" }],
    });
    expect(judgeAskedUi(read(cards), [], ["area"])).toMatchObject({ kind: "refused", problems: [{ kind: "nothing_to_ask" }] });
  });

  it("asks only for the errand's missing fields", () => {
    const form = (fields: string[]) => read([{ component: "AskForm", props: { fields } }]);
    expect(judgeAskedUi(form(["timeWindow"]), [], ["timeWindow"]).kind).toBe("drawable");
    expect(judgeAskedUi(form(["timeWindow", "area"]), [], ["timeWindow"])).toMatchObject({
      kind: "refused",
      problems: [{ kind: "asks_known_field", field: "area" }],
    });
  });

  it("names every provider id the program binds to", () => {
    const nodes = [...cards, { component: "PriceChart", props: { providerIds: ["prv_1", "prv_2"] } }];
    expect(providerIdsIn(nodes)).toEqual(["prv_1", "prv_2"]);
  });
});
