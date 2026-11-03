import type { RequiredField } from "../errand/errand";
import type { GeneratedUiReading, UiNode } from "../ports/generated-ui-reader";
import { COMPONENT_RULES, isCommitPhrase } from "./library-rules";

// Judging a generated-UI program before the chat draws it. A program the parser can't read falls
// back to text; one it can read is refused when it reaches outside the library, carries an action,
// offers an approval as a chip, asks where it should show (or the reverse), or names an id the
// world doesn't have. What it may never do is decided here, not by the model or the client.

export type UiProblem =
  | { readonly kind: "unknown_component"; readonly component: string }
  | { readonly kind: "pending_component"; readonly component: string; readonly pendingOn: string }
  | { readonly kind: "action_not_allowed"; readonly what: string }
  | { readonly kind: "commit_phrase"; readonly component: string; readonly text: string }
  | { readonly kind: "ask_in_present"; readonly component: string }
  | { readonly kind: "nothing_to_ask" }
  | { readonly kind: "asks_known_field"; readonly field: string }
  | { readonly kind: "unknown_provider"; readonly providerId: string }
  | { readonly kind: "unknown_booking"; readonly bookingId: string };

export type GeneratedUiVerdict =
  | { readonly kind: "drawable"; readonly components: readonly string[]; readonly warnings: readonly string[] }
  | { readonly kind: "unreadable"; readonly errors: readonly string[] }
  | { readonly kind: "refused"; readonly problems: readonly UiProblem[] };

function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  return [];
}

function libraryProblems(node: UiNode): UiProblem[] {
  const rule = COMPONENT_RULES[node.component];
  if (rule === undefined) return [{ kind: "unknown_component", component: node.component }];
  const pending: UiProblem[] =
    rule.pendingOn === undefined ? [] : [{ kind: "pending_component", component: node.component, pendingOn: rule.pendingOn }];
  const commits: UiProblem[] = rule.tappableTextProps
    .flatMap((prop) => textsIn(node.props[prop]))
    .filter(isCommitPhrase)
    .map((text) => ({ kind: "commit_phrase", component: node.component, text }));
  return [...pending, ...commits];
}

function structuralProblems(nodes: readonly UiNode[], foreign: readonly string[]): UiProblem[] {
  return [
    ...foreign.map((what): UiProblem => ({ kind: "action_not_allowed", what })),
    ...nodes.flatMap(libraryProblems),
  ];
}

function isAsking(node: UiNode): boolean {
  return COMPONENT_RULES[node.component]?.role === "ask";
}

function idsIn(nodes: readonly UiNode[], propsOf: (component: string) => readonly string[]): string[] {
  const ids = nodes.flatMap((node) => propsOf(node.component).flatMap((prop) => textsIn(node.props[prop])));
  return [...new Set(ids)];
}

/** Every provider id the program names, for the world to confirm. */
export function providerIdsIn(nodes: readonly UiNode[]): string[] {
  return idsIn(nodes, (component) => COMPONENT_RULES[component]?.providerIdProps ?? []);
}

/** Every booking id the program names, for the world to confirm. */
export function bookingIdsIn(nodes: readonly UiNode[]): string[] {
  return idsIn(nodes, (component) => COMPONENT_RULES[component]?.bookingIdProps ?? []);
}

function verdictOf(reading: Extract<GeneratedUiReading, { kind: "read" }>, problems: readonly UiProblem[]): GeneratedUiVerdict {
  if (problems.length > 0) return { kind: "refused", problems };
  return { kind: "drawable", components: [...new Set(reading.nodes.map((node) => node.component))], warnings: reading.warnings };
}

/** A program for *present*: it shows, so it may not ask. */
export function judgePresentedUi(reading: GeneratedUiReading, unknownIds: readonly UiProblem[]): GeneratedUiVerdict {
  if (reading.kind === "unreadable") return reading;
  const asking = reading.nodes.filter(isAsking).map((node): UiProblem => ({ kind: "ask_in_present", component: node.component }));
  return verdictOf(reading, [...structuralProblems(reading.nodes, reading.foreign), ...asking, ...unknownIds]);
}

/**
 * A program for *ask*: it must ask something, and a missing-details form may ask only for the
 * errand's missing fields, so the person is never asked again for what they already said.
 */
export function judgeAskedUi(
  reading: GeneratedUiReading,
  unknownIds: readonly UiProblem[],
  missing: readonly RequiredField[],
): GeneratedUiVerdict {
  if (reading.kind === "unreadable") return reading;
  const asks = reading.nodes.filter(isAsking);
  const known = reading.nodes
    .filter((node) => node.component === "AskForm")
    .flatMap((node) => textsIn(node.props.fields))
    .filter((field) => !missing.some((gap) => gap === field))
    .map((field): UiProblem => ({ kind: "asks_known_field", field }));
  const nothing: UiProblem[] = asks.length === 0 ? [{ kind: "nothing_to_ask" }] : [];
  return verdictOf(reading, [...structuralProblems(reading.nodes, reading.foreign), ...nothing, ...known, ...unknownIds]);
}
