import { GENERATED_UI_COMPONENTS } from "@errand/contracts";
import { describe, expect, it } from "vitest";

import { COMPONENT_RULES } from "../../core/generated-ui/library-rules";
import { generatedUiInstructions, openUiLangReader } from "./openui-lang-reader";

const CARDS = [
  "root = Stack([cards])",
  'cards = ProviderChoices([a], "Pick one")',
  'a = ProviderChoice("prv_plumber_koramangala_5", "Cheapest", "Good for a quick fix")',
].join("\n");

describe("the OpenUI Lang reader", () => {
  it("reads a program into its component calls", () => {
    const reading = openUiLangReader.read(CARDS);
    expect(reading.kind === "read" && reading.nodes.map((node) => node.component)).toEqual(["Stack", "ProviderChoices", "ProviderChoice"]);
  });

  it("finds no program in prose or a cut-off program", () => {
    expect(openUiLangReader.read("Here are your options!").kind).toBe("unreadable");
    expect(openUiLangReader.read('root = Stack([cards])\ncards = ProviderChoices([a], "Pi').kind).toBe("unreadable");
    expect(openUiLangReader.read("").kind).toBe("unreadable");
  });

  it("reports an unknown component as a parse error", () => {
    const reading = openUiLangReader.read('root = Stack([b])\nb = ApproveButton("Approve ₹399")');
    expect(reading).toMatchObject({ kind: "unreadable" });
    expect(reading.kind === "unreadable" && reading.errors.join(" ")).toContain("ApproveButton");
  });

  it("drops an extra argument such as a price, and says so", () => {
    const reading = openUiLangReader.read(CARDS.replace('"Good for a quick fix")', '"Good for a quick fix", 99)'));
    expect(reading.kind).toBe("read");
    if (reading.kind !== "read") return;
    expect(reading.nodes[2]?.props).toEqual({ providerId: "prv_plumber_koramangala_5", highlight: "Cheapest", reason: "Good for a quick fix" });
    expect(reading.warnings.join(" ")).toContain("excess-args");
  });

  it("finds mutations and action steps the model tried to add", () => {
    const mutation = openUiLangReader.read('root = Stack([x])\nx = Mutation("book", {})');
    expect(mutation.kind === "read" && mutation.foreign).toContain("Mutation x");
    const step = openUiLangReader.read('root = Stack([f])\nf = FollowUps([@ToAssistant("approve")])');
    expect(step.kind === "read" ? step.foreign.length : 1).toBeGreaterThan(0);
  });
});

describe("the component library", () => {
  it("has the same components in the contract and in core's rule table", () => {
    expect(GENERATED_UI_COMPONENTS.map((component) => component.name).sort()).toEqual(Object.keys(COMPONENT_RULES).sort());
  });

  it("has no approve, confirm or pay component", () => {
    for (const component of GENERATED_UI_COMPONENTS) expect(component.name).not.toMatch(/approv|confirm|pay|checkout|grant|commit|book(it|now|button)|^book$/i);
  });

  it("offers the model every component of the library", () => {
    const instructions = generatedUiInstructions();
    for (const name of Object.keys(COMPONENT_RULES)) expect(instructions).toContain(`${name}(`);
  });

  it("keeps its instructions within their share of the context budget", () => {
    // 5,222 characters measured live at 1,235 MiniMax input tokens (docs/notes/openui-spike.md),
    // about 4.2 characters a token; 10k characters (about 2.4k tokens) is the cap for ticket 12.
    expect(generatedUiInstructions().length).toBeLessThan(10_000);
  });
});
