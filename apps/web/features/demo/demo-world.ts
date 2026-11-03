import type { EveMessage } from "@errand/client";
import type { ErrandView, GetErrandHandoffsResponse, ListMemoryResponse, OperatorReadKind } from "@errand/contracts";

import { recording, type RecordedFlow } from "./recording";

// The demo's whole world, in the browser: its chats, proposals, memory and hand-offs. It starts from the
// recording and keeps the visitor's changes in sessionStorage, so a reload or a link keeps them and a
// forgotten fact stays forgotten for the tab's session. "Reset demo" clears it. Nothing here talks to a
// server.

const STORAGE_KEY = "errand.demo.v1";

export interface DemoChat {
  readonly id: string;
  readonly createdAtMs: number;
  messages: EveMessage[];
  running: boolean;
  /** Started from the home composer, with its chips saved as the errand. */
  drafted: boolean;
  /** Started from a New errand card: the job it carries, by its search. */
  carried?: { readonly service: string; readonly area: string };
  /** The recorded chat whose options this one shows, once it searched. */
  flow?: RecordedFlow;
  /** The proposal waiting on the person's tap, or the one being booked. */
  proposalId?: string;
  errand: ErrandView | null;
  booked: boolean;
  /** How many beats have played: suffixes the replayed ids, so a beat can play twice in one chat. */
  beats: number;
}

export type ProposalPhase = "pending" | "approved" | "executed" | "declined";

export interface DemoProposal {
  readonly id: string;
  readonly sessionId: string;
  /** The recorded proposal this one replays. */
  readonly flow: RecordedFlow;
  readonly createdAtMs: number;
  phase: ProposalPhase;
  /** When Approve was tapped (demo clock), for the booking's progress. */
  approvedAtMs?: number;
}

export interface OperatorReadCount {
  reads: number;
  firstAtMs: number;
  lastAtMs: number;
}

export interface DemoState {
  readonly version: 1;
  /** Wall-clock ms when this demo started; the demo clock runs from the recording's pinned start. */
  readonly startedAtMs: number;
  chats: Record<string, DemoChat>;
  proposals: Record<string, DemoProposal>;
  memory: ListMemoryResponse;
  handoffs: Record<string, GetErrandHandoffsResponse>;
  operatorReads: Record<string, Partial<Record<OperatorReadKind, OperatorReadCount>>>;
  nextId: number;
}

/** The chat a provider's cancellation opened: it is there before the visitor does anything. */
function cancelledChat(startedAtMs: number): DemoChat {
  const session = recording.sessions.cancelled;
  const pending = recording.proposals["cancelled:pending"] as { proposalId: string };
  return {
    id: session.sessionId,
    createdAtMs: startedAtMs,
    messages: [...(session.opening ?? [])],
    running: false,
    drafted: false,
    flow: "cancelled",
    proposalId: pending.proposalId,
    errand: null,
    booked: false,
    beats: 1,
  };
}

function initialState(): DemoState {
  const startedAtMs = Date.now();
  const chat = cancelledChat(startedAtMs);
  const pending = recording.proposals["cancelled:pending"] as { proposalId: string };
  return {
    version: 1,
    startedAtMs,
    chats: { [chat.id]: chat },
    proposals: { [pending.proposalId]: { id: pending.proposalId, sessionId: chat.id, flow: "cancelled", createdAtMs: startedAtMs, phase: "pending" } },
    memory: structuredClone(recording.memory),
    handoffs: {},
    operatorReads: {},
    nextId: 1,
  };
}

function load(): DemoState {
  if (typeof window === "undefined") return initialState();
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    const state = saved === null ? undefined : (JSON.parse(saved) as DemoState);
    if (state?.version === 1) {
      // A turn cut off by a reload ends where it stopped.
      for (const chat of Object.values(state.chats)) chat.running = false;
      return state;
    }
  } catch {
    // An unreadable save starts the demo again.
  }
  return initialState();
}

let state: DemoState | undefined;
const listeners = new Set<() => void>();
let version = 0;

export function demoState(): DemoState {
  state ??= load();
  return state;
}

/** Applies a change, saves it and tells every subscriber. */
export function change<T>(apply: (state: DemoState) => T): T {
  const result = apply(demoState());
  version += 1;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(demoState()));
    } catch {
      // A full storage keeps the demo working for this page.
    }
  }
  for (const listener of listeners) listener();
  return result;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes with every change, for useSyncExternalStore. */
export function stateVersion(): number {
  return version;
}

export function resetDemo(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
  state = initialState();
  change(() => undefined);
}

/** The demo clock: the recording's pinned start (Wed 4 Nov 2026, 09:00 IST), moving on in real time. */
export function demoNowMs(): number {
  return Date.parse(recording.clockStart) + (Date.now() - demoState().startedAtMs);
}

export function demoNowIso(): string {
  return new Date(demoNowMs()).toISOString();
}

export function newId(prefix: string): string {
  return change((current) => `${prefix}_demo_${current.nextId++}`);
}

/** Replaces every occurrence of the recorded ids with the demo's, anywhere in a recorded value. */
export function rewrite<T>(value: T, replacements: Readonly<Record<string, string>>): T {
  const entries = Object.entries(replacements).filter(([from, to]) => from !== to);
  if (entries.length === 0) return structuredClone(value);
  let text = JSON.stringify(value);
  for (const [from, to] of entries) text = text.split(JSON.stringify(from)).join(JSON.stringify(to));
  return JSON.parse(text) as T;
}
