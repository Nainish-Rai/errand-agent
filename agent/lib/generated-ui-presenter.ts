import type { GeneratedUiToolOutput } from "@errand/contracts";

import type { GeneratedUiVerdict } from "../../src/core/generated-ui/generated-ui";
import { problemText } from "../../src/core/use-cases/generated-ui-session";

// A generated-UI verdict as the present_ui / ask_ui tool result. The message tells the model what
// happened and what to do next; the chat reads `kind` to decide whether to draw the program.

const FALL_BACK = "It was not drawn, so answer in text instead (don't retry the same UI).";

function presentDrawable(verdict: Extract<GeneratedUiVerdict, { kind: "drawable" }>, kind: "shown" | "asked"): GeneratedUiToolOutput {
  const message =
    kind === "shown"
      ? "Shown in the chat. Add one short line of text; don't repeat what the UI shows."
      : "Shown in the chat. Write one short line asking them to answer it, then end your turn: their answer comes as their next message.";
  return { kind, components: [...verdict.components], message };
}

function presentVerdict(verdict: GeneratedUiVerdict, kind: "shown" | "asked"): GeneratedUiToolOutput {
  switch (verdict.kind) {
    case "drawable":
      return presentDrawable(verdict, kind);
    case "unreadable":
      return { kind: "unreadable", errors: [...verdict.errors], message: `The UI didn't parse: ${verdict.errors.join("; ")}. ${FALL_BACK}` };
    case "refused": {
      const problems = verdict.problems.map(problemText);
      return { kind: "refused", problems, message: `The UI was refused: ${problems.join("; ")}. ${FALL_BACK}` };
    }
  }
}

export function presentShownUi(verdict: GeneratedUiVerdict): GeneratedUiToolOutput {
  return presentVerdict(verdict, "shown");
}

export function presentAskedUi(verdict: GeneratedUiVerdict): GeneratedUiToolOutput {
  return presentVerdict(verdict, "asked");
}
