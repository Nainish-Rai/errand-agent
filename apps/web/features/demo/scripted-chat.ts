import type { EveMessage, EveMessagePart, EveToolPart } from "@errand/client";
import { CARD_FOLLOW_UPS, ProposeActionOutputSchema, type ErrandView, type ProposalCard } from "@errand/contracts";

import { BOOKING_MS, replacementsFor } from "./demo-proposals";
import { change, demoNowMs, demoState, newId, rewrite, type DemoChat, type DemoProposal } from "./demo-world";
import { beatOf, recording, type RecordedFlow } from "./recording";

// The demo's chat: no model, no backend. What the person says is matched by keywords to a recorded
// turn of the real backend (the same eve messages and tool outputs, under fresh ids), which then plays
// out like a live turn: each tool call runs for a moment before its result lands, and text streams in.
// Anything it doesn't recognise gets a short line pointing at the suggestions.

const FALLBACK =
  "This demo has scripted replies, so it only follows a few requests. Try a suggestion on the home screen, or ask for a plumber, " +
  "AC servicing, an electrician, a deep clean or a carpenter this week. The real agent, with a model, is in the repo.";

const ONLY_RECORDED_PLUMBERS =
  "In this demo I can hold Shiva Sanitary Solutions (the cheapest) or Venkatesh Sanitary Solutions (the best match), the two plumbers " +
  "whose bookings were recorded. The real agent holds whichever you pick.";

const ALREADY_BOOKED = "This chat's errand is booked. For another job, ask for it here and I'll offer to start it in a new chat.";

/** How long each tool call "runs" before its result shows. */
const TOOL_MS: Readonly<Record<string, number>> = {
  search_providers: 900,
  get_provider_insight: 700,
  hold_slot: 500,
  propose_action: 450,
  execute_proposal: 600,
  update_errand: 300,
};

const WORDS_PER_TICK = 4;
const TICK_MS = 35;

type Service = "plumber" | "ac_servicing" | "electrician" | "cleaner" | "carpenter";

const SEARCH_FLOWS: Readonly<Record<Exclude<Service, "plumber">, RecordedFlow>> = {
  ac_servicing: "ac",
  electrician: "electrician",
  cleaner: "cleaner",
  carpenter: "carpenter",
};

/** The two plumbers whose holds and bookings were recorded, by the name a Choose button sends. */
const BOOKABLE: Readonly<Record<string, RecordedFlow>> = {
  "shiva sanitary solutions": "plumber",
  "venkatesh sanitary solutions": "best",
};

function serviceIn(text: string): Service | undefined {
  if (/\b(ac|a\/c|aircon|air ?con\w*|air-con\w*|cooling)\b/.test(text)) return "ac_servicing";
  if (/plumb|\btap\b|leak|pipe|drain|sink|toilet|geyser/.test(text)) return "plumber";
  if (/electric|wiring|\bfan\b|switch|socket/.test(text)) return "electrician";
  if (/clean/.test(text)) return "cleaner";
  if (/carpent|furniture|wardrobe|\bdoor\b|shelf|cabinet/.test(text)) return "carpenter";
  // "what about my mom's place in HSR": the AC repair the demo's second errand is about.
  if (/\bmom\b|mother|\bhsr\b/.test(text)) return "ac_servicing";
  return undefined;
}

function isForMomInHsr(text: string): boolean {
  return /\bmom\b|mother|\bhsr\b/.test(text);
}

function namesATime(text: string): boolean {
  return /week|today|tonight|tomorrow|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|morning|afternoon|evening|asap|soon|now\b/.test(text);
}

function isAffirmation(text: string): boolean {
  return /^(yes|yeah|yep|ok|okay|sure|go ahead|book it|confirm|do it|approve)\b/.test(text);
}

// --- state helpers ---------------------------------------------------------------------------------

function updateChat(sessionId: string, update: (chat: DemoChat) => DemoChat): void {
  change((state) => {
    const chat = state.chats[sessionId];
    if (chat !== undefined) state.chats[sessionId] = update(chat);
  });
}

function setMessage(sessionId: string, message: EveMessage): void {
  updateChat(sessionId, (chat) => {
    const at = chat.messages.findIndex((candidate) => candidate.id === message.id);
    const messages = at === -1 ? [...chat.messages, message] : chat.messages.map((candidate, index) => (index === at ? message : candidate));
    return { ...chat, messages };
  });
}

function pendingProposal(chat: DemoChat): DemoProposal | undefined {
  const proposal = chat.proposalId === undefined ? undefined : demoState().proposals[chat.proposalId];
  return proposal?.phase === "pending" ? proposal : undefined;
}

function newChat(id: string): DemoChat {
  return { id, createdAtMs: demoNowMs(), messages: [], running: false, drafted: false, errand: null, booked: false, beats: 0 };
}

export function ensureChat(sessionId: string): void {
  if (demoState().chats[sessionId] !== undefined) return;
  change((state) => {
    state.chats[sessionId] = newChat(sessionId);
  });
}

export function createChat(): string {
  const id = newId("chat");
  ensureChat(id);
  return id;
}

// --- replies -----------------------------------------------------------------------------------------

interface Reply {
  readonly messages: readonly EveMessage[];
  /** The chat's errand after the turn. */
  readonly errand?: ErrandView | null;
  /** Applied when the reply has played out. */
  readonly settle?: (chat: DemoChat) => DemoChat;
  /** The tool call that books, which runs until the booking settles. */
  readonly booking?: DemoProposal;
}

function textMessage(sessionId: string, text: string): EveMessage {
  const id = newId(`msg_${sessionId}`);
  return { id, role: "assistant", parts: [{ type: "text", id: `${id}_text`, text, state: "done" }], metadata: { status: "complete" } };
}

/** A recorded turn under fresh ids (so it can play twice in one chat), with the demo's proposal for the recorded one. */
function replay(chat: DemoChat, flow: RecordedFlow, key: string, proposal?: DemoProposal): { messages: readonly EveMessage[]; errand: ErrandView | null } {
  const beat = beatOf(flow, key);
  const suffix = `~${chat.beats}`;
  const ids: Record<string, string> = proposal === undefined ? {} : replacementsFor(proposal);
  for (const message of beat.messages) {
    ids[message.id] = `${message.id}${suffix}`;
    for (const part of message.parts) {
      if (part.type === "tool") ids[part.callId] = `${part.callId}${suffix}`;
      else if ((part.type === "text" || part.type === "reasoning") && part.id !== undefined) ids[part.id] = `${part.id}${suffix}`;
    }
  }
  const errand = beat.errand === null ? null : rewrite(beat.errand, ids);
  return { messages: rewrite(beat.messages, ids), errand };
}

/** The recorded tool parts named `name`, changed by `map` (the recorded output or input with the demo's own values). */
function mapToolParts(messages: readonly EveMessage[], name: string, map: (part: EveToolPart) => object): EveMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => (part.type === "tool" && part.name === name ? (map(part) as EveMessagePart) : part)),
  }));
}

function search(chat: DemoChat, flow: RecordedFlow, key = "search"): Reply {
  const { messages, errand } = replay(chat, flow, key);
  return { messages, errand, settle: (settled) => ({ ...settled, flow }) };
}

function newProposal(chat: DemoChat, flow: RecordedFlow): DemoProposal {
  const proposal: DemoProposal = { id: newId("prp"), sessionId: chat.id, flow, createdAtMs: demoNowMs(), phase: "pending" };
  change((state) => {
    state.proposals[proposal.id] = proposal;
  });
  return proposal;
}

function choose(chat: DemoChat, providerName: string): Reply {
  if (chat.booked) return { messages: [textMessage(chat.id, ALREADY_BOOKED)] };
  const flow = BOOKABLE[providerName.trim().toLowerCase()];
  if (flow === undefined) return { messages: [textMessage(chat.id, ONLY_RECORDED_PLUMBERS)] };
  const proposal = newProposal(chat, flow);
  const { messages, errand } = replay(chat, flow === "best" ? "best" : "plumber", "choose", proposal);
  return { messages, errand, settle: (settled) => ({ ...settled, proposalId: proposal.id }) };
}

/** The approval card the proposal was put up with, as propose_action returned it. */
function cardOf(proposal: DemoProposal): ProposalCard | undefined {
  const source = proposal.flow === "cancelled" ? (recording.sessions.cancelled.opening ?? []) : beatOf(proposal.flow, "choose").messages;
  const output = source.flatMap((message) => message.parts).find((part) => part.type === "tool" && part.name === "propose_action");
  const parsed = ProposeActionOutputSchema.safeParse(output?.type === "tool" ? output.output : undefined);
  return parsed.success && parsed.data.kind === "proposed" ? rewrite(parsed.data.proposal, replacementsFor(proposal)) : undefined;
}

/** A typed "yes" books nothing: execute_proposal finds no grant and the same card shows again. */
function typedYes(chat: DemoChat, proposal: DemoProposal): Reply {
  const card = cardOf(proposal);
  if (card === undefined) return { messages: [textMessage(chat.id, "Nothing is booked yet: a typed “yes” doesn't count. Tap Approve on the card.")] };
  const price = card.terms.action === "book" ? `₹${card.terms.priceInr.toLocaleString("en-IN")}` : "";
  const { messages } = replay(chat, "plumber", "typed-yes", proposal);
  const withCard = mapToolParts(messages, "execute_proposal", (part) => ({ ...part, output: { ...(part.output as object), proposal: card } }));
  return {
    messages: withCard.map((message) => ({
      ...message,
      parts: message.parts.map((part) => (part.type === "text" ? { ...part, text: part.text.replace("₹399", price) } : part)),
    })),
  };
}

function approve(chat: DemoChat): Reply {
  const proposal = chat.proposalId === undefined ? undefined : demoState().proposals[chat.proposalId];
  if (proposal === undefined || proposal.phase !== "approved") {
    // Only the card's Approve approves; these words alone are a typed yes.
    const pending = pendingProposal(chat);
    return pending === undefined ? { messages: [textMessage(chat.id, FALLBACK)] } : typedYes(chat, pending);
  }
  const { messages, errand } = replay(chat, proposal.flow, "approve", proposal);
  return {
    messages,
    errand,
    booking: proposal,
    settle: (settled) => ({ ...settled, booked: true }),
  };
}

function decline(chat: DemoChat): Reply {
  const proposal = chat.proposalId === undefined ? undefined : demoState().proposals[chat.proposalId];
  if (proposal === undefined || proposal.flow === "cancelled") {
    return { messages: [textMessage(chat.id, "Nothing is booked. Tell me what to look for instead, or pick a suggestion on the home screen.")] };
  }
  const { messages, errand } = replay(chat, "decline", "declined");
  return { messages, errand, settle: (settled) => ({ ...settled, proposalId: undefined, flow: "decline" }) };
}

/** A different job in a booked chat: the search is refused and the New errand card offers a new chat. */
function newJob(chat: DemoChat, service: Service, area: string): Reply {
  const { messages } = replay(chat, "plumber", "new-job");
  return {
    messages: mapToolParts(messages, "search_providers", (part) => ({ ...part, input: { ...(part.input as object), service, area } })),
  };
}

function requestFor(chat: DemoChat, text: string): Reply {
  const service = serviceIn(text) ?? (chat.carried?.service as Service | undefined);
  if (service === undefined) return { messages: [textMessage(chat.id, FALLBACK)] };
  const hsr = isForMomInHsr(text) || chat.carried?.area === "HSR Layout";
  if (chat.booked) return newJob(chat, service, hsr ? "HSR Layout" : "Koramangala");
  if (service === "ac_servicing" && hsr) return search(chat, "ac-hsr");
  if (service !== "plumber") return search(chat, SEARCH_FLOWS[service]);
  // No time named: the agent asks with a form instead of guessing.
  if (!namesATime(text)) return search(chat, "ask-form", "ask");
  return /leak|\btap\b|drip/.test(text) ? search(chat, "plumber") : search(chat, "ask-form", "answer");
}

function replyTo(chat: DemoChat, said: string): Reply {
  const text = said.trim();
  const lower = text.toLowerCase();
  if (text === CARD_FOLLOW_UPS.approved) return approve(chat);
  if (text === CARD_FOLLOW_UPS.declined || text === CARD_FOLLOW_UPS.otherOptions) return decline(chat);
  const chosen = /^I'll take (.+?)(?:,|\.$)/.exec(text)?.[1];
  if (chosen !== undefined) return choose(chat, chosen);
  const pending = pendingProposal(chat);
  if (pending !== undefined && isAffirmation(lower)) return typedYes(chat, pending);
  if (/^when:/i.test(text)) return search(chat, "ask-form", "answer");
  if (/compar|chart|price|cheaper|spend|spent/.test(lower)) return charts(chat);
  return requestFor(chat, lower);
}

function charts(chat: DemoChat): Reply {
  const { messages } = replay(chat, "plumber", "charts");
  return { messages };
}

// --- playback ----------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns cut short by Stop: playback checks it between steps. */
const stopped = new Set<string>();

function runningPart(part: EveMessagePart & { type: "tool" }): EveMessagePart {
  const { output: _output, error: _error, ...rest } = part;
  return { ...rest, state: "running" } as EveMessagePart;
}

async function play(sessionId: string, reply: Reply): Promise<void> {
  for (const recorded of reply.messages) {
    let parts: EveMessagePart[] = [];
    const show = (status: "streaming" | "complete") =>
      setMessage(sessionId, { ...recorded, parts: [...parts], metadata: { ...recorded.metadata, status: status === "streaming" ? "streaming" : (recorded.metadata?.status ?? "complete") } });
    show("streaming");
    for (const part of recorded.parts) {
      if (stopped.has(sessionId)) break;
      if (part.type === "tool") {
        parts = [...parts, runningPart(part)];
        show("streaming");
        const booking = reply.booking !== undefined && part.name === "execute_proposal";
        await sleep(booking ? BOOKING_MS : (TOOL_MS[part.name] ?? 400));
        if (booking && reply.booking !== undefined) {
          const proposalId = reply.booking.id;
          change((state) => {
            const proposal = state.proposals[proposalId];
            if (proposal !== undefined) proposal.phase = "executed";
          });
        }
        parts = [...parts.slice(0, -1), part];
        show("streaming");
        continue;
      }
      if (part.type === "text") {
        const before = parts;
        const words = part.text.split(/(?<=\s)/);
        for (let shown = WORDS_PER_TICK; shown < words.length && !stopped.has(sessionId); shown += WORDS_PER_TICK) {
          parts = [...before, { ...part, text: words.slice(0, shown).join(""), state: "streaming" }];
          show("streaming");
          await sleep(TICK_MS);
        }
        parts = [...before, { ...part, state: "done" }];
        show("streaming");
        continue;
      }
      parts = [...parts, part];
    }
    show("complete");
  }
}

/** The person's words in the chat, then the scripted turn. Resolves once the words are in, like eve's send. */
export async function sendToChat(sessionId: string, said: string): Promise<void> {
  ensureChat(sessionId);
  const chat = demoState().chats[sessionId];
  if (chat === undefined) return;
  const message: EveMessage = { id: newId(`msg_${sessionId}_user`), role: "user", parts: [{ type: "text", text: said }], metadata: { status: "complete" } };
  updateChat(sessionId, (current) => ({ ...current, messages: [...current.messages, message], running: true, beats: current.beats + 1 }));
  stopped.delete(sessionId);
  const reply = replyTo(demoState().chats[sessionId] ?? chat, said);
  void play(sessionId, reply).finally(() =>
    updateChat(sessionId, (current) => {
      const settled = reply.settle?.(current) ?? current;
      return { ...settled, running: false, ...(reply.errand === undefined ? {} : { errand: reply.errand }) };
    }),
  );
}

export function stopChat(sessionId: string): void {
  stopped.add(sessionId);
}
