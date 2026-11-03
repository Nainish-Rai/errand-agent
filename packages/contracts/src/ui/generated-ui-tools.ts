import { z } from "zod";

// The present_ui and ask_ui tools on the wire. The input is the OpenUI Lang program; the output is
// the backend's verdict on it. The chat draws the program only when the verdict says so, and the
// evals read the same verdicts from the conversation.

export const GeneratedUiToolInputSchema = z.object({
  ui: z.string().describe("The OpenUI Lang program, starting with `root = Stack([...])`"),
});

export const GeneratedUiToolOutputSchema = z.discriminatedUnion("kind", [
  /** present_ui: drawn as written. */
  z.object({ kind: z.literal("shown"), components: z.array(z.string()), message: z.string() }),
  /** ask_ui: drawn; the answer comes back as the person's next message. */
  z.object({ kind: z.literal("asked"), components: z.array(z.string()), message: z.string() }),
  /** It didn't parse: not drawn, the reply's text stands, and the errors are in the trace. */
  z.object({ kind: z.literal("unreadable"), errors: z.array(z.string()), message: z.string() }),
  /** It parsed but broke a rule (an action, an approval chip, an unknown id, ...): not drawn. */
  z.object({ kind: z.literal("refused"), problems: z.array(z.string()), message: z.string() }),
]);

export type GeneratedUiToolInput = z.infer<typeof GeneratedUiToolInputSchema>;
export type GeneratedUiToolOutput = z.infer<typeof GeneratedUiToolOutputSchema>;

/** The tool names, which come from the files under agent/tools/. */
export const GENERATED_UI_TOOLS = { present: "present_ui", ask: "ask_ui" } as const;
