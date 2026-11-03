"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { GeneratedUiToolInputSchema, GeneratedUiToolOutputSchema } from "@errand/contracts";
import { OpenUIContent } from "@openuidev/assistant-ui";

import { Spinner } from "@/components/ui/spinner";

import { generatedUiLibrary } from "./library";

// present_ui and ask_ui in the assistant-ui thread. The tool's input is the OpenUI Lang program;
// its result is the backend's verdict. Only a program the backend drew ("shown" or "asked") is
// rendered, with OpenUI's renderer and our library. Anything else (it didn't parse, or broke a
// rule) is not drawn: the reply's own text stands in for it and the reason is in the run trace.
// OpenUI's theme comes from GeneratedUiTheme around the whole chat.

function TextFallback() {
  return (
    <p data-testid="generated-ui-fallback" className="my-1 text-label text-fg-meta">
      This part couldn't be drawn here, so the reply says it in text.
    </p>
  );
}

export const GeneratedUiPart: ToolCallMessagePartComponent = ({ args, result, isError }) => {
  if (isError === true) return <TextFallback />;
  if (result === undefined) {
    return (
      <div className="my-2 flex items-center gap-2 text-label text-fg-meta">
        <Spinner /> Laying it out…
      </div>
    );
  }
  const input = GeneratedUiToolInputSchema.safeParse(args);
  const verdict = GeneratedUiToolOutputSchema.safeParse(result);
  if (!input.success || !verdict.success || (verdict.data.kind !== "shown" && verdict.data.kind !== "asked")) return <TextFallback />;

  return (
    <div data-testid="generated-ui" data-surface={verdict.data.kind} className="openui-host">
      <OpenUIContent response={input.data.ui} isStreaming={false} library={generatedUiLibrary} disableThemeProvider ErrorFallback={TextFallback} />
    </div>
  );
};
