import { GENERATED_UI_COMPONENTS, GENERATED_UI_ROOT } from "@errand/contracts";
import { createLibrary, createParser, defineComponent } from "@openuidev/lang-core";

// A generated-UI program read on the client side, the way the chat's renderer reads it: the same
// library (packages/contracts ui/generated-ui.ts) parsed with OpenUI's own parser. The evals use it
// to see what the chat would draw; the backend judges programs with its own copy of the library.

export interface ProgramElement {
  readonly component: string;
  readonly props: Readonly<Record<string, unknown>>;
}

const library = createLibrary({
  components: GENERATED_UI_COMPONENTS.map((component) => defineComponent({ ...component, component: null })),
  root: GENERATED_UI_ROOT,
});

const parser = createParser(library.toJSONSchema(), GENERATED_UI_ROOT);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collect(value: unknown, into: ProgramElement[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === "element" && typeof value.typeName === "string") {
    const props = isRecord(value.props) ? value.props : {};
    into.push({ component: value.typeName, props });
    for (const prop of Object.values(props)) collect(prop, into);
    return;
  }
  for (const nested of Object.values(value)) collect(nested, into);
}

export interface ParsedProgram {
  /** Every component call the program draws, depth first; empty when it has no root. */
  readonly elements: readonly ProgramElement[];
  /** Why it doesn't parse cleanly; an extra argument the parser dropped is not an error. */
  readonly errors: readonly string[];
}

export function parseProgram(program: string): ParsedProgram {
  const { root, meta } = parser.parse(program);
  const errors = [
    ...meta.errors.filter((error) => error.code !== "excess-args").map((error) => `${error.code}: ${error.message}`),
    ...(root === null ? ["no root"] : []),
    ...(meta.incomplete ? ["incomplete"] : []),
    ...meta.unresolved.map((name) => `unresolved ${name}`),
  ];
  const elements: ProgramElement[] = [];
  if (root !== null) collect(root, elements);
  return { elements, errors };
}

/** Every component call the program draws, depth first, or undefined when it has no root. */
export function elementsOf(program: string): ProgramElement[] | undefined {
  const parsed = parseProgram(program);
  return parsed.elements.length === 0 ? undefined : [...parsed.elements];
}

/** The elements of one component, with their props as the contract types them. */
export function elementsNamed<T>(elements: readonly ProgramElement[], component: string): T[] {
  return elements.filter((element) => element.component === component).map((element) => element.props as T);
}
