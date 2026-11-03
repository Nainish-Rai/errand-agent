import type { ChatEntry } from "./chat-screen";

// How a link opens the chat: `?rail=memory` opens the memory panel, `?proposal=ID` scrolls to that
// proposal's approval card. Anything else is ignored, including the old `?rail=trace`: the trace is
// for operators now, in the console at /ops.

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function chatEntryOf(params: SearchParams): ChatEntry {
  const rail = first(params.rail);
  const proposalId = first(params.proposal);
  return {
    ...(rail === "memory" ? { rail } : {}),
    ...(proposalId === undefined || proposalId === "" ? {} : { proposalId }),
  };
}
