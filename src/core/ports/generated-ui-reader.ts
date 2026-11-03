// Reads a generated-UI payload (an OpenUI Lang program) into plain nodes core can judge. The
// adapter owns the parser; core only sees what the program would draw.

/** One component call in the program, with its props as the parser mapped them. */
export interface UiNode {
  readonly component: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export type GeneratedUiReading =
  | {
      readonly kind: "read";
      /** Every component call reachable from the root, depth first, the root first. */
      readonly nodes: readonly UiNode[];
      /**
       * Everything in the program that isn't a component or a plain value: action steps
       * (`@ToAssistant`, `@OpenUrl`, `@Run`), `Query`/`Mutation` statements, `$state` and runtime
       * references. Generated UI may not carry any of them, since a button's behaviour is fixed in code.
       */
      readonly foreign: readonly string[];
      /** Problems the parser fixed by dropping what the model wrote, e.g. an extra argument. */
      readonly warnings: readonly string[];
    }
  | { readonly kind: "unreadable"; readonly errors: readonly string[] };

export interface GeneratedUiReader {
  read(program: string): GeneratedUiReading;
}
