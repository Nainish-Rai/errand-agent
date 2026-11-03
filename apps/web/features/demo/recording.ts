import type { EveMessage } from "@errand/client";
import type {
  ActionIntentView,
  ApproveProposalResponse,
  BookingView,
  DeclineProposalResponse,
  ErrandView,
  GetAvailabilityResponse,
  GetErrandHandoffsResponse,
  GetHomeSummaryResponse,
  GetSessionContextResponse,
  GetSessionTraceResponse,
  GetSessionTranscriptResponse,
  GetSpendResponse,
  ListMemoryResponse,
  ListServiceOptionsResponse,
  OperatorSession,
  ProposalView,
  ProviderDetails,
  SearchProvidersInput,
  StartNewErrandResponse,
} from "@errand/contracts";

import recordingJson from "./recording.json";

// The demo's fixture, recorded from the real backend by `pnpm demo:record` (scripts/demo): every chat
// message, tool output and API answer the demo replays is what the real core and mock world returned
// for the evals' scripted model turns. recording.test.ts checks it against the contracts, so a change to
// the wire that the fixture no longer matches fails `pnpm check` until it is recorded again.

export interface RecordedBeat {
  readonly key: string;
  readonly say: string | null;
  /** The turn's assistant messages, as eve projected them. */
  readonly messages: readonly EveMessage[];
  /** The chat's errand after the turn. */
  readonly errand: ErrandView | null;
}

export interface RecordedSession {
  readonly sessionId: string;
  readonly beats: readonly RecordedBeat[];
  readonly handoffs: GetErrandHandoffsResponse;
  /** A chat the backend opened itself: its messages before the person said anything. */
  readonly opening?: readonly EveMessage[];
}

/** Which recorded chat a beat or proposal comes from. */
export type RecordedFlow = "plumber" | "best" | "decline" | "ask-form" | "ac-hsr" | "ac" | "electrician" | "cleaner" | "carpenter" | "cancelled";

export interface DemoRecording {
  readonly clockStart: string;
  readonly home: { readonly initial: GetHomeSummaryResponse; readonly afterBooking: GetHomeSummaryResponse };
  readonly memory: ListMemoryResponse;
  readonly services: ListServiceOptionsResponse;
  readonly bookings: { readonly initial: readonly BookingView[]; readonly afterBooking: readonly BookingView[] };
  readonly spend: GetSpendResponse;
  readonly sessions: Readonly<Record<RecordedFlow, RecordedSession>>;
  /** `flow:phase`: pending, approve (the route's answer), approved, executed, decline, declined. */
  readonly proposals: Readonly<Record<string, ProposalView | ApproveProposalResponse | DeclineProposalResponse>>;
  /** `flow:during` (the ledger at each step of the booking) and `flow:settled`. */
  readonly intents: Readonly<Record<string, readonly ActionIntentView[] | readonly (readonly ActionIntentView[])[]>>;
  readonly handoffs: Readonly<Record<string, { readonly moved: StartNewErrandResponse; readonly toolCallId: string; readonly search: SearchProvidersInput }>>;
  readonly providers: readonly ProviderDetails[];
  readonly availability: GetAvailabilityResponse;
}

export interface RecordedOpsSession {
  readonly sessionId: string;
  readonly trace: GetSessionTraceResponse;
  readonly context: GetSessionContextResponse;
  readonly transcript: GetSessionTranscriptResponse;
}

export interface DemoOpsRecording {
  readonly sessions: readonly OperatorSession[];
  /** The plumber chat this demo replays, as the operator console showed it when it was recorded. */
  readonly demoChat: RecordedOpsSession;
  /** docs/traces/timeout-after-success.jsonl, read through the backend's own trace use case and presenter. */
  readonly committed: RecordedOpsSession & { readonly startedAt: string };
}

export const recording = recordingJson as unknown as DemoRecording;

/** The operator view's traces are large, so they load only when /ops asks for them. */
export async function loadOpsRecording(): Promise<DemoOpsRecording> {
  const ops = await import("./ops-recording.json");
  return ops.default as unknown as DemoOpsRecording;
}

export function proposalAt(flow: RecordedFlow, phase: "pending" | "approved" | "executed" | "declined"): ProposalView | undefined {
  return recording.proposals[`${flow}:${phase}`] as ProposalView | undefined;
}

export function beatOf(flow: RecordedFlow, key: string): RecordedBeat {
  const beat = recording.sessions[flow].beats.find((candidate) => candidate.key === key);
  if (beat === undefined) throw new Error(`The recording has no ${flow}/${key} beat.`);
  return beat;
}
