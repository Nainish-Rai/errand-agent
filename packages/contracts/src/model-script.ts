import { z } from "zod";

// A scenario's scripted model turns, loaded into the backend's offline model with the dev-only
// PUT /api/v1/dev/model-script. Turn n answers the nth user message; step m is the model's mth
// response since that message (each tool result sends the model back for another step).

export const ScriptedToolCallSchema = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

/** One model response: text, tool calls, or both. */
export const ModelStepSchema = z
  .object({
    text: z.string().optional(),
    toolCalls: z.array(ScriptedToolCallSchema).optional(),
  })
  .refine((step) => step.text !== undefined || (step.toolCalls?.length ?? 0) > 0, "A step needs text or a tool call.");

export const ModelScriptTurnSchema = z.object({
  steps: z.array(ModelStepSchema).min(1),
  /** After the last step, start again from the first: a model that never stops (run budget evals). */
  loop: z.boolean().optional(),
});

export const ModelScriptSchema = z.object({
  turns: z.array(ModelScriptTurnSchema),
});

/** `script: null` unloads the script, so the backend falls back to its default offline responder. */
export const LoadModelScriptRequestSchema = z.object({
  script: ModelScriptSchema.nullable(),
});

export const LoadModelScriptResponseSchema = z.object({
  loaded: z.boolean(),
  turns: z.number().int().nonnegative(),
});

export type ScriptedToolCall = z.infer<typeof ScriptedToolCallSchema>;
export type ModelStep = z.infer<typeof ModelStepSchema>;
export type ModelScriptTurn = z.infer<typeof ModelScriptTurnSchema>;
export type ModelScript = z.infer<typeof ModelScriptSchema>;
export type LoadModelScriptRequest = z.input<typeof LoadModelScriptRequestSchema>;
export type LoadModelScriptResponse = z.infer<typeof LoadModelScriptResponseSchema>;
