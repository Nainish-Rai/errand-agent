import type { RunKey } from "../../src/core/budget/run-budget";

// A run is one turn of one session. The model (through eve's dynamic context) and the tools
// (through their call context) name the same run, so both charge the same budget.

/** Only reached outside a turn, which no model or tool call is. Named so a stray budget is easy to spot. */
const OUTSIDE_A_TURN = "outside-a-turn";

interface DynamicRunContext {
  readonly session: { readonly id: string };
  readonly turn: { readonly id: string } | null;
}

interface ToolRunContext {
  readonly session: { readonly id: string; readonly turn: { readonly id: string } };
}

export function runKeyOf(ctx: DynamicRunContext): RunKey {
  return { sessionId: ctx.session.id, turnId: ctx.turn?.id ?? OUTSIDE_A_TURN };
}

export function toolRunKeyOf(ctx: ToolRunContext): RunKey {
  return { sessionId: ctx.session.id, turnId: ctx.session.turn.id };
}
