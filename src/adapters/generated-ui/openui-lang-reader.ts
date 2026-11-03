import { GENERATED_UI_COMPONENTS, GENERATED_UI_ROOT } from "@errand/contracts";
import { createLibrary, createParser, defineComponent, type ParseResult } from "@openuidev/lang-core";

import type { GeneratedUiReader, GeneratedUiReading, UiNode } from "../../core/ports/generated-ui-reader";

// OpenUI Lang on the server: the same component library the web app renders (packages/contracts
// ui/generated-ui.ts), without renderers. It parses what the model wrote, so core can judge it
// before the chat draws it, and it writes the library's part of the model's instructions.
//
// lang-core's runtime telemetry is opt-in (OPENUI_RUNTIME_TELEMETRY_ENABLED) and we never opt in;
// its install-time script is not in pnpm's allowBuilds, so it never runs either.

/** The library: what the parser accepts and what the model is offered. */
const library = createLibrary({
  components: GENERATED_UI_COMPONENTS.map((component) => defineComponent({ ...component, component: null })),
  root: GENERATED_UI_ROOT,
});

const parser = createParser(library.toJSONSchema(), GENERATED_UI_ROOT);

/** Validation codes the parser recovers from by dropping what the model wrote. */
const RECOVERED_CODES = new Set(["excess-args"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walks the parsed tree: component calls become nodes, anything executable becomes foreign. */
function collect(value: unknown, nodes: UiNode[], foreign: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, nodes, foreign);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "element" && typeof value.typeName === "string") {
    const props = isRecord(value.props) ? value.props : {};
    nodes.push({ component: value.typeName, props });
    for (const prop of Object.values(props)) collect(prop, nodes, foreign);
    return;
  }
  // Unevaluated expressions (action steps such as @ToAssistant, $state and runtime references)
  // are AST nodes, tagged with `k`.
  if (typeof value.k === "string") {
    const name = typeof value.name === "string" ? value.name : typeof value.n === "string" ? value.n : "";
    foreign.push(name === "" ? value.k : `${value.k} ${name}`);
    return;
  }
  for (const nested of Object.values(value)) collect(nested, nodes, foreign);
}

function readingOf(result: ParseResult): GeneratedUiReading {
  const { root, meta } = result;
  const errors = meta.errors.filter((error) => !RECOVERED_CODES.has(error.code)).map((error) => `${error.code}: ${error.message}`);
  if (root === null) errors.push("no-root: the program has no `root = Stack(...)` statement");
  else if (root.typeName !== GENERATED_UI_ROOT) errors.push(`wrong-root: the root is ${root.typeName}, not ${GENERATED_UI_ROOT}`);
  if (meta.incomplete) errors.push("incomplete: the program stops part-way through a statement");
  if (meta.unresolved.length > 0) errors.push(`unresolved: ${meta.unresolved.join(", ")} used but never defined`);
  if (errors.length > 0) return { kind: "unreadable", errors };

  const nodes: UiNode[] = [];
  const foreign: string[] = [
    ...result.queryStatements.map((query) => `Query ${query.statementId}`),
    ...result.mutationStatements.map((mutation) => `Mutation ${mutation.statementId}`),
    ...Object.keys(result.stateDeclarations).map((name) => `state ${name}`),
  ];
  collect(root, nodes, foreign);
  const warnings = [
    ...meta.errors.filter((error) => RECOVERED_CODES.has(error.code)).map((error) => `${error.code}: ${error.message}`),
    ...meta.orphaned.map((name) => `orphaned: ${name} is never shown`),
  ];
  return { kind: "read", nodes, foreign, warnings };
}

export const openUiLangReader: GeneratedUiReader = {
  read(program) {
    if (program.trim() === "") return { kind: "unreadable", errors: ["empty: the program is empty"] };
    try {
      return readingOf(parser.parse(program));
    } catch (error) {
      return { kind: "unreadable", errors: [`parse-exception: ${error instanceof Error ? error.message : String(error)}`] };
    }
  },
};

const PREAMBLE = [
  "# Generated UI",
  "",
  "You can draw small interfaces in the chat with OpenUI Lang: `present_ui` shows something, `ask_ui` asks the person " +
    "something. Pass the program as the tool's `ui` argument; never write OpenUI Lang in your reply text.",
].join("\n");

const RULES = [
  "Components take ids from tool results (providerId, bookingId). Never write a price, rating, time, date or status: the " +
    "components fill those in from the provider's real data, and anything you write there is dropped.",
  "There is no approve, confirm or pay component, and no chip may say so. Booking is only ever approved on the fixed approval card.",
  "Always write a one-line text reply as well, saying the same in words; it is what the person sees if the UI can't be drawn.",
  "search_providers' options already show as choice cards with photos: don't present the same options again.",
  "Use PriceChart only for 4 or more options. Use SlotsPerDayChart when the person asks when someone is free. Use SpendChart only when asked about spending.",
  "When update_errand returns a question, call ask_ui with AskForm listing exactly the question's fields, then end your turn.",
  "ReviewInsight only for a provider get_provider_insight returned an insight for. PreferenceCard only in ask_ui, with the fact ids of inferred facts waiting for confirmation (remember_fact's fact.id).",
  "After ask_ui, end your turn and wait: the answer comes back as the person's next message.",
  "If a tool result says the UI was refused or didn't parse, answer in text instead.",
];

const EXAMPLES = [
  [
    "root = Stack([cards, next])",
    'cards = ProviderChoices([a, b], "Two good fits")',
    'a = ProviderChoice("prv_ac_servicing_indiranagar_2", "Gas refill included", "Covers the refill your AC needs")',
    'b = ProviderChoice("prv_ac_servicing_indiranagar_4", "Same-day", "Can come today")',
    'next = FollowUps(["Show evening slots", "Who is free on Saturday?"])',
  ].join("\n"),
  ["root = Stack([form])", 'form = AskForm(["timeWindow"], "When should they come?")'].join("\n"),
];

/** The library's part of the model's instructions. It counts toward the context budget. */
export function generatedUiInstructions(): string {
  return library.prompt({ preamble: PREAMBLE, additionalRules: RULES, examples: EXAMPLES });
}
