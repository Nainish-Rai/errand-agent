import { ApiRequestError, type AppApi } from "@errand/client";
import type {
  ActionIntentView,
  ApproveProposalRequest,
  ApproveProposalResponse,
  BookingView,
  CorrectMemoryFactRequest,
  DeclineProposalResponse,
  DismissNewErrandRequest,
  DraftErrandRequest,
  ErrandAtWorkView,
  ErrandHandoffView,
  ErrandView,
  ForgetMemoryFactResponse,
  GetAvailabilityResponse,
  GetErrandHandoffsResponse,
  GetHomeSummaryResponse,
  GetSessionContextResponse,
  GetSessionTraceResponse,
  GetSessionTranscriptResponse,
  GetSpendResponse,
  ListMemoryResponse,
  ListOperatorReadsResponse,
  ListServiceOptionsResponse,
  MemoryFactView,
  MemoryKey,
  OperatorReadKind,
  OperatorSession,
  ProposalStatus,
  ProposalView,
  ProviderDetails,
  StartNewErrandRequest,
  StartNewErrandResponse,
  UpcomingVisitView,
} from "@errand/contracts";

import { approvalOf, bookingOf, holdSecondsLeft, intentOf, proposalView, sessionIntents } from "./demo-proposals";
import { change, demoNowIso, demoNowMs, demoState, newId, rewrite, type DemoChat } from "./demo-world";
import { loadOpsRecording, recording, type RecordedOpsSession } from "./recording";

// The app API with no server: the same methods as ApiClient (packages/client), answered from the
// recording and the demo's in-browser state. Reads return what the real backend returned for the same
// world; the visitor's taps (approve, decline, the memory panel, a New errand card) change the state the
// way the real use cases would, and the dev-only routes don't exist here.

const MEMORY_LABELS: Readonly<Record<MemoryKey, string>> = {
  area: "Area",
  budget: "Budget",
  earliest_hour: "Earliest start",
  favourite_technician: "Favourite technician",
  preferences: "Preferences",
};

function displayOf(key: MemoryKey, value: string): string {
  switch (key) {
    case "budget":
      return `₹${Number(value).toLocaleString("en-IN")}`;
    case "earliest_hour":
      return `${value.padStart(2, "0")}:00`;
    case "area":
    case "favourite_technician":
    case "preferences":
      return value;
  }
}

/** The value core would store, or why it refuses it (the memory panel shows the reason). */
function normalizedValue(key: MemoryKey, value: string): string | undefined {
  const text = value.trim();
  switch (key) {
    case "area":
      return recording.home.initial.composer.areas.find((area) => area.toLowerCase() === text.toLowerCase());
    case "budget": {
      const amount = Number(text.replace(/[₹,\s]/g, ""));
      return Number.isFinite(amount) && amount > 0 ? String(Math.round(amount)) : undefined;
    }
    case "earliest_hour": {
      const hour = Number(text.replace(/:00$/, ""));
      return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour) : undefined;
    }
    case "favourite_technician":
    case "preferences":
      return text === "" ? undefined : text;
  }
}

function notInDemo(): never {
  throw new ApiRequestError(404, "not_found", "This route isn't part of the demo.");
}

function currentFact(memory: ListMemoryResponse, key: MemoryKey): MemoryFactView | undefined {
  return memory.facts.find((fact) => fact.key === key && (fact.status === "active" || fact.status === "pending_confirmation"));
}

function activeValue(key: MemoryKey): string | undefined {
  return demoState().memory.facts.find((fact) => fact.key === key && fact.status === "active")?.value;
}

function isUnfinished(errand: ErrandView): boolean {
  return !["done", "failed", "cancelled"].includes(errand.state);
}

function atWork(chat: DemoChat, errand: ErrandView): ErrandAtWorkView {
  const last = errand.transitions.at(-1);
  return {
    sessionId: chat.id,
    errandId: errand.errandId,
    state: errand.state,
    waitingOn: ["gathering", "choosing", "awaiting_approval"].includes(errand.state) ? "person" : "agent",
    since: new Date(last?.atMs ?? chat.createdAtMs).toISOString(),
    service: errand.service,
    area: errand.area,
    timeWindow: errand.timeWindow,
    budgetInr: errand.budgetInr,
  };
}

function demoProposals() {
  return Object.values(demoState().proposals).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function proposalOrThrow(proposalId: string) {
  const proposal = demoState().proposals[proposalId];
  if (proposal === undefined) throw new ApiRequestError(404, "proposal_not_found", "No such proposal.");
  return proposal;
}

function upcomingOf(view: ProposalView, intent: ActionIntentView | undefined): UpcomingVisitView | undefined {
  if (view.terms.action !== "book") return undefined;
  const visit = { providerName: view.terms.providerName, service: view.terms.service, slot: view.terms.slot, priceInr: view.terms.priceInr };
  if (intent?.state === "confirmed" && intent.bookingId !== null) return { kind: "booked", bookingId: intent.bookingId, ...visit };
  if (view.status === "approved") return { kind: "checking", proposalId: view.proposalId, sessionId: view.sessionId, ...visit };
  return undefined;
}

export class MockApiClient implements AppApi {
  async getProviders(providerIds: readonly string[]): Promise<readonly ProviderDetails[]> {
    return recording.providers.filter((provider) => providerIds.includes(provider.id));
  }

  async getProvider(providerId: string): Promise<ProviderDetails> {
    const provider = recording.providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined) throw new ApiRequestError(404, "provider_not_found", "No such provider.");
    return provider;
  }

  async getAvailability(providerIds: readonly string[]): Promise<GetAvailabilityResponse> {
    const known = new Set(recording.providers.map((provider) => provider.id));
    return {
      days: recording.availability.days.map((day) => {
        const byProvider = day.byProvider.filter((entry) => providerIds.includes(entry.providerId));
        return { date: day.date, freeSlots: byProvider.reduce((sum, entry) => sum + entry.freeSlots, 0), byProvider };
      }),
      unknownProviderIds: providerIds.filter((id) => !known.has(id)),
    };
  }

  async getSpend(months: number): Promise<GetSpendResponse> {
    return { months: recording.spend.months.slice(-months) };
  }

  async listServiceOptions(): Promise<ListServiceOptionsResponse> {
    return recording.services;
  }

  async getErrand(sessionId: string): Promise<ErrandView | null> {
    return demoState().chats[sessionId]?.errand ?? null;
  }

  async getHomeSummary(): Promise<GetHomeSummaryResponse> {
    const base = recording.home.initial;
    const { memory, chats } = demoState();
    const views = demoProposals().map((proposal) => ({ proposal, view: proposalView(proposal), intent: intentOf(proposal) }));
    const working = Object.values(chats).flatMap((chat) => (chat.errand !== null && isUnfinished(chat.errand) ? [atWork(chat, chat.errand)] : []));
    // The cancelled visit's chat replays the recording's errand until its card is settled.
    const recordedWork = base.working.filter((work) => chats[work.sessionId]?.errand === null && !chats[work.sessionId]?.booked);
    const approvals = views.flatMap(({ proposal, view }) =>
      proposal.phase === "pending" && view.terms.action === "book" && holdSecondsLeft(proposal) > 0
        ? [{ proposalId: view.proposalId, sessionId: proposal.sessionId, providerName: view.terms.providerName, service: view.terms.service, slot: view.terms.slot, priceInr: view.terms.priceInr, holdSecondsLeft: holdSecondsLeft(proposal) }]
        : [],
    );
    const pendingFacts = memory.facts.filter((fact) => fact.status === "pending_confirmation");
    const upcoming = [...base.upcoming, ...views.flatMap(({ view, intent }) => upcomingOf(view, intent) ?? [])].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
    const rebooked = (alertProposal: string | null) => alertProposal !== null && demoState().proposals[alertProposal]?.phase === "executed";
    // The home screen counts an alert's age on the browser's clock, so each alert is as old here as it
    // is on the demo clock (otherwise one raised at the pinned 09:00 reads 0:00 for ever before then).
    const onBrowserClock = (at: string) => new Date(Date.parse(at) - demoNowMs() + Date.now()).toISOString();
    const alerts = base.alerts.map((alert) => ({
      ...alert,
      at: onBrowserClock(alert.at),
      ...(alert.kind === "provider_cancelled" ? { rebooked: alert.rebooked || rebooked(alert.proposalId) } : {}),
    }));
    const booked = upcoming.filter((visit) => visit.kind === "booked" && !base.upcoming.includes(visit));
    const days = base.activity.days.map((day) => {
      const visits = booked.filter((visit) => visit.slot.start.startsWith(day.date));
      return { ...day, bookings: day.bookings + visits.length, bookedInr: day.bookedInr + visits.reduce((sum, visit) => sum + visit.priceInr, 0) };
    });
    const allWork = [...recordedWork, ...working];
    return {
      ...base,
      generatedAt: demoNowIso(),
      counts: {
        running: allWork.length,
        waitingOnYou: approvals.length + pendingFacts.length,
        alerts: alerts.filter((alert) => alert.kind !== "provider_cancelled" || !alert.rebooked).length,
      },
      working: allWork,
      waiting: { approvals, facts: pendingFacts },
      upcoming,
      alerts,
      activity: { ...base.activity, days },
      memory: memory.facts.filter((fact) => fact.status === "active" || fact.status === "pending_confirmation"),
      composer: {
        ...base.composer,
        area: activeValue("area") ?? null,
        budgetInr: activeValue("budget") === undefined ? null : Number(activeValue("budget")),
        earliestHour: activeValue("earliest_hour") === undefined ? null : Number(activeValue("earliest_hour")),
      },
    };
  }

  async draftErrand(sessionId: string, request: DraftErrandRequest): Promise<ErrandView | null> {
    if (request.area === null && request.budgetInr === null && request.when === null) return null;
    const errand: ErrandView = {
      errandId: `errand_${sessionId}`,
      state: "gathering",
      service: null,
      area: request.area,
      timeWindow: request.when === null ? null : { from: "2026-11-04", to: "2026-11-10", ...request.when },
      budgetInr: request.budgetInr,
      preferences: [],
      missing: ["service"],
      question: null,
      transitions: [{ sequence: 0, from: null, to: "gathering", reason: "errand_started", atMs: demoNowMs() }],
    };
    change((state) => {
      const chat = state.chats[sessionId];
      if (chat === undefined) return;
      chat.drafted = true;
      chat.errand = errand;
    });
    return errand;
  }

  async getErrandHandoffs(sessionId: string): Promise<GetErrandHandoffsResponse> {
    return demoState().handoffs[sessionId] ?? { settled: [], startedFrom: null };
  }

  async startNewErrand(sessionId: string, request: StartNewErrandRequest): Promise<StartNewErrandResponse> {
    const earlier = demoState().handoffs[sessionId]?.settled.find((handoff) => handoff.toolCallId === request.toolCallId);
    if (earlier?.kind === "dismissed") throw new ApiRequestError(409, "not_refused", "This card was already dismissed.");
    if (earlier !== undefined) return { handoff: earlier, errand: null };
    const from = demoState().chats[sessionId]?.errand ?? null;
    const at = demoNowIso();
    const handoff: ErrandHandoffView = { kind: "moved", toolCallId: request.toolCallId, toSessionId: request.toSessionId, at };
    const recorded = recording.handoffs["ac-hsr"]?.moved.errand ?? null;
    const errand: ErrandView | null =
      recorded === null ? null : { ...rewrite(recorded, { [recorded.errandId]: `errand_${request.toSessionId}` }), service: request.search.service as ErrandView["service"], area: request.search.area };
    change((state) => {
      const origin = state.handoffs[sessionId] ?? { settled: [], startedFrom: null };
      state.handoffs[sessionId] = { ...origin, settled: [...origin.settled, handoff] };
      state.handoffs[request.toSessionId] = { settled: [], startedFrom: { sessionId, service: from?.service ?? null, area: from?.area ?? null, at } };
      const chat = state.chats[request.toSessionId];
      if (chat !== undefined) {
        chat.carried = { service: request.search.service, area: request.search.area };
        chat.errand = errand;
      }
    });
    return { handoff, errand };
  }

  async dismissNewErrand(sessionId: string, request: DismissNewErrandRequest): Promise<ErrandHandoffView> {
    const earlier = demoState().handoffs[sessionId]?.settled.find((handoff) => handoff.toolCallId === request.toolCallId);
    if (earlier !== undefined) return earlier;
    const handoff: ErrandHandoffView = { kind: "dismissed", toolCallId: request.toolCallId, at: demoNowIso() };
    change((state) => {
      const origin = state.handoffs[sessionId] ?? { settled: [], startedFrom: null };
      state.handoffs[sessionId] = { ...origin, settled: [...origin.settled, handoff] };
    });
    return handoff;
  }

  // The operator console: the committed real trace and the recorded run of this demo's plumber chat.

  async #opsSession(sessionId: string, kind: OperatorReadKind): Promise<RecordedOpsSession> {
    const ops = await loadOpsRecording();
    const session = [ops.committed, ops.demoChat].find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) throw new ApiRequestError(404, "not_found", "No such session.");
    change((state) => {
      const reads = (state.operatorReads[sessionId] ??= {});
      const now = demoNowMs();
      const count = (reads[kind] ??= { reads: 0, firstAtMs: now, lastAtMs: now });
      count.reads += 1;
      count.lastAtMs = now;
    });
    return session;
  }

  async getSessionTrace(sessionId: string): Promise<GetSessionTraceResponse> {
    return (await this.#opsSession(sessionId, "trace")).trace;
  }

  async getSessionContext(sessionId: string): Promise<GetSessionContextResponse> {
    return (await this.#opsSession(sessionId, "context")).context;
  }

  async listOperatorSessions(): Promise<readonly OperatorSession[]> {
    const ops = await loadOpsRecording();
    const demoChat = ops.sessions.find((session) => session.sessionId === ops.demoChat.sessionId);
    return [
      ...(demoChat === undefined ? [] : [demoChat]),
      // The committed trace's chat booked the cheapest Koramangala plumber, like the demo's.
      { sessionId: ops.committed.sessionId, ownerId: "dev-user", startedAt: ops.committed.startedAt, errand: demoChat?.errand ?? null },
    ];
  }

  async getSessionTranscript(sessionId: string): Promise<GetSessionTranscriptResponse> {
    return (await this.#opsSession(sessionId, "transcript")).transcript;
  }

  async listOperatorReads(sessionId: string): Promise<ListOperatorReadsResponse> {
    const reads = demoState().operatorReads[sessionId] ?? {};
    return {
      sessionId,
      reads: Object.entries(reads).map(([kind, count]) => ({
        operatorId: "demo-operator",
        kind: kind as OperatorReadKind,
        reads: count.reads,
        firstReadAt: new Date(count.firstAtMs).toISOString(),
        lastReadAt: new Date(count.lastAtMs).toISOString(),
      })),
    };
  }

  // The approval card: Approve is the only way a proposal is approved, here as in the real backend.

  async approveProposal(proposalId: string, request: ApproveProposalRequest): Promise<ApproveProposalResponse> {
    const proposal = proposalOrThrow(proposalId);
    if (proposal.phase === "approved" || proposal.phase === "executed") return approvalOf(proposal);
    if (proposal.phase === "declined") throw new ApiRequestError(409, "proposal_not_pending", "This card was declined, so it can't be approved.");
    if (holdSecondsLeft(proposal) === 0) throw new ApiRequestError(410, "hold_expired", "The hold ran out. Ask me to hold the slot again.");
    if (request.fingerprint !== proposalView(proposal).fingerprint) throw new ApiRequestError(409, "fingerprint_mismatch", "The terms changed. Check the card again.");
    change((state) => {
      const live = state.proposals[proposalId];
      if (live === undefined) return;
      live.phase = "approved";
      live.approvedAtMs = demoNowMs();
    });
    return approvalOf(proposal);
  }

  async declineProposal(proposalId: string): Promise<DeclineProposalResponse> {
    const proposal = proposalOrThrow(proposalId);
    if (proposal.phase === "pending") {
      change((state) => {
        const live = state.proposals[proposalId];
        if (live !== undefined) live.phase = "declined";
      });
    }
    return { proposalId, status: proposalView(proposalOrThrow(proposalId)).status };
  }

  async getProposal(proposalId: string): Promise<ProposalView> {
    return proposalView(proposalOrThrow(proposalId));
  }

  async listProposals(options: { readonly status?: ProposalStatus } = {}): Promise<readonly ProposalView[]> {
    return demoProposals()
      .map(proposalView)
      .filter((view) => options.status === undefined || view.status === options.status);
  }

  async listSessionProposals(sessionId: string): Promise<readonly ProposalView[]> {
    return demoProposals()
      .filter((proposal) => proposal.sessionId === sessionId)
      .map(proposalView);
  }

  async listBookings(): Promise<readonly BookingView[]> {
    const made = demoProposals().flatMap((proposal) => bookingOf(proposal) ?? []);
    return [...recording.bookings.initial, ...made];
  }

  // Memory, as core keeps it: a correction supersedes the fact, a forget closes it and leaves a tombstone.

  async listMemory(): Promise<ListMemoryResponse> {
    return demoState().memory;
  }

  async correctMemoryFact(key: MemoryKey, request: CorrectMemoryFactRequest): Promise<MemoryFactView> {
    const value = normalizedValue(key, request.value);
    if (value === undefined) throw new ApiRequestError(422, "invalid_value", `That isn't a ${MEMORY_LABELS[key].toLowerCase()} I can remember.`);
    const previous = currentFact(demoState().memory, key);
    if (previous === undefined) throw new ApiRequestError(404, "not_found", `Nothing is remembered for ${MEMORY_LABELS[key].toLowerCase()}.`);
    if (previous.value === value && previous.status === "active") return previous;
    const id = newId("fact");
    const at = demoNowIso();
    const fact: MemoryFactView = {
      id,
      key,
      label: MEMORY_LABELS[key],
      value,
      display: displayOf(key, value),
      source: "explicit",
      status: "active",
      evidence: { kind: "user_action", action: "correct" },
      validFrom: at,
      validTo: null,
      supersedes: previous.id,
      supersededBy: null,
      confirmedAt: null,
    };
    change((state) => {
      state.memory = {
        ...state.memory,
        facts: [...state.memory.facts.map((old) => (old.id === previous.id ? { ...old, status: "superseded" as const, validTo: at, supersededBy: id } : old)), fact],
      };
    });
    return fact;
  }

  async forgetMemoryFact(key: MemoryKey): Promise<ForgetMemoryFactResponse> {
    const tombstone = { key, label: MEMORY_LABELS[key], forgottenAt: demoNowIso() };
    change((state) => {
      state.memory = {
        facts: state.memory.facts.map((fact) =>
          fact.key === key && (fact.status === "active" || fact.status === "pending_confirmation") ? { ...fact, status: "forgotten" as const, validTo: tombstone.forgottenAt } : fact,
        ),
        tombstones: [...state.memory.tombstones.filter((old) => old.key !== key), tombstone],
      };
    });
    return { tombstone };
  }

  async confirmMemoryFact(factId: string): Promise<MemoryFactView> {
    const fact = demoState().memory.facts.find((candidate) => candidate.id === factId);
    if (fact === undefined) throw new ApiRequestError(404, "not_found", "Nothing is remembered with that id.");
    if (fact.status !== "pending_confirmation") throw new ApiRequestError(409, "not_pending", "That fact isn't waiting to be confirmed.");
    const confirmed: MemoryFactView = { ...fact, status: "active", confirmedAt: demoNowIso() };
    change((state) => {
      state.memory = { ...state.memory, facts: state.memory.facts.map((old) => (old.id === factId ? confirmed : old)) };
    });
    return confirmed;
  }

  async listActionIntents(): Promise<readonly ActionIntentView[]> {
    return Object.keys(demoState().chats).flatMap(sessionIntents);
  }

  async listSessionActionIntents(sessionId: string): Promise<readonly ActionIntentView[]> {
    return sessionIntents(sessionId);
  }

  // Dev-only routes: the demo has no world to switch, no model to script and no faults to inject.

  async seedMemory(): Promise<never> {
    notInDemo();
  }

  async loadModelScript(): Promise<never> {
    notInDemo();
  }

  async setRunLimits(): Promise<never> {
    notInDemo();
  }

  async getWorldFault(): Promise<never> {
    notInDemo();
  }

  async injectWorldFault(): Promise<never> {
    notInDemo();
  }

  async simulateProviderCancellation(): Promise<never> {
    notInDemo();
  }

  async switchScenario(): Promise<never> {
    notInDemo();
  }
}
