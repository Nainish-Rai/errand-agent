"use client";

import type { GetHomeSummaryResponse, HomeAlertView, MemoryFactView, UpcomingVisitView } from "@errand/contracts";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { MemoryChip } from "@/components/chip";
import { EmptyState } from "@/components/empty-state";
import { InferredValue } from "@/components/inferred-value";
import { Money } from "@/components/money";
import { Skeleton } from "@/components/skeleton";
import { StatusMark } from "@/components/status-mark";
import { SegmentedControl } from "@/components/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListRow, MiniBarChart, NeedsYouDot, Widget } from "@/components/widget";

import { dateLabel, errandDetails, errandTitle, serviceLabel, sinceLabel, slotLabel, stepLabel } from "./errand-words";
import { ErrandMark } from "./errand-mark";

// The six home widgets, each on Widget and ListRow, each with live data from GET /api/v1/home and
// a designed empty state. Until the first summary arrives every widget shows skeleton rows.

type Summary = GetHomeSummaryResponse;

/** While the first summary loads. */
function LoadingRows() {
  return (
    <div className="grid gap-2 py-1">
      <Skeleton className="w-3/4" />
      <Skeleton className="w-1/2" />
      <Skeleton className="w-2/3" />
    </div>
  );
}

function Rows({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none grid-cols-[minmax(0,1fr)] p-0">
      {children}
    </ul>
  );
}

function RowLink({ href, label, children }: { readonly href: string; readonly label: string; readonly children: ReactNode }) {
  return (
    <Button asChild size="sm" variant="secondary" className="flex-none">
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}

function chatHref(sessionId: string, entry: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams(entry).toString();
  return `/chat/${encodeURIComponent(sessionId)}${query === "" ? "" : `?${query}`}`;
}

/** The chat that shows the person's memory: the session a guess came from, or a new chat. */
function memoryHref(fact: MemoryFactView): string {
  return fact.evidence.kind === "user_message" ? chatHref(fact.evidence.sessionId, { rail: "memory" }) : "/chat?rail=memory";
}

export function WorkingNow({ summary, nowMs }: { readonly summary?: Summary; readonly nowMs: number }) {
  const working = summary?.working ?? [];
  return (
    <Widget icon="〜" title="Working now" count={summary === undefined ? undefined : { value: working.length, tone: "plain" }} busy={summary === undefined}>
      {summary === undefined ? (
        <LoadingRows />
      ) : working.length === 0 ? (
        <EmptyState message="Nothing in progress. Errands you start show their current step here." />
      ) : (
        <Rows label="Errands in progress">
          {working.slice(0, 4).map((errand) => (
            <li key={errand.errandId}>
              <Link href={chatHref(errand.sessionId)} className="block rounded-md hover:bg-surface-2">
                <ListRow
                  lead={<ErrandMark waitingOn={errand.waitingOn} />}
                  title={errandTitle(errand)}
                  meta={`${stepLabel(errand.state)} · ${errandDetails(errand)}`}
                  action={<span className="text-xs text-fg-3 tabular-nums">{sinceLabel(errand.since, nowMs)}</span>}
                />
              </Link>
            </li>
          ))}
        </Rows>
      )}
    </Widget>
  );
}

function holdLeft(seconds: number): string {
  return seconds >= 60 ? `hold ${Math.floor(seconds / 60)}m left` : `hold ${seconds}s left`;
}

export function WaitingOnYou({ summary }: { readonly summary?: Summary }) {
  const approvals = summary?.waiting.approvals ?? [];
  const facts = summary?.waiting.facts ?? [];
  const count = approvals.length + facts.length;
  return (
    <Widget
      icon="◷"
      title="Waiting on you"
      count={summary === undefined ? undefined : count > 0 ? { value: count, tone: "needs-you" } : { value: 0, tone: "plain" }}
      busy={summary === undefined}
    >
      {summary === undefined ? (
        <LoadingRows />
      ) : count === 0 ? (
        <EmptyState message="Nothing needs you. Approval cards and guesses to confirm show up here." />
      ) : (
        <Rows label="Things waiting on you">
          {approvals.map((approval) => (
            <li key={approval.proposalId}>
              <ListRow
                lead={<NeedsYouDot />}
                title={`Approve booking · ${approval.providerName}`}
                meta={
                  <>
                    {slotLabel(approval.slot.start)} · <Money amount={approval.priceInr} /> · {holdLeft(approval.holdSecondsLeft)}
                  </>
                }
                action={
                  <RowLink href={chatHref(approval.sessionId, { proposal: approval.proposalId })} label={`Review approval: ${approval.providerName}`}>
                    Review
                  </RowLink>
                }
              />
            </li>
          ))}
          {facts.map((fact) => (
            <li key={fact.id}>
              <ListRow
                lead={<NeedsYouDot />}
                title={
                  <span className="inline-flex items-baseline gap-1.5">
                    Confirm {fact.label.toLowerCase()} <InferredValue label="inferred">{fact.display}</InferredValue>?
                  </span>
                }
                meta="a guess · not used until you confirm"
                action={
                  <RowLink href={memoryHref(fact)} label={`Confirm in memory: ${fact.label} ${fact.display}`}>
                    Confirm
                  </RowLink>
                }
              />
            </li>
          ))}
        </Rows>
      )}
    </Widget>
  );
}

function visitRow(visit: UpcomingVisitView) {
  const title = `${serviceLabel(visit.service)} · ${visit.providerName}`;
  if (visit.kind === "booked") {
    return (
      <ListRow
        lead={<StatusMark kind="ok" label="Booked" className="w-20 flex-none" />}
        title={title}
        meta={slotLabel(visit.slot.start)}
        action={<Money amount={visit.priceInr} className="text-xs text-fg-3" />}
      />
    );
  }
  return (
    <Link href={chatHref(visit.sessionId)} className="block rounded-md hover:bg-surface-2">
      <ListRow
        lead={<StatusMark kind="checking" label="Checking" className="w-20 flex-none" />}
        title={title}
        meta={`${slotLabel(visit.slot.start)} · checking with the provider`}
        action={<Money amount={visit.priceInr} className="text-xs text-fg-3" />}
      />
    </Link>
  );
}

export function UpcomingBookings({ summary }: { readonly summary?: Summary }) {
  const upcoming = summary?.upcoming ?? [];
  return (
    <Widget icon="▤" title="Upcoming bookings" count={summary === undefined ? undefined : { value: upcoming.length, tone: "plain" }} busy={summary === undefined}>
      {summary === undefined ? (
        <LoadingRows />
      ) : upcoming.length === 0 ? (
        <EmptyState message="No upcoming bookings. A booking shows here once the provider confirms it." />
      ) : (
        <Rows label="Upcoming visits">
          {upcoming.slice(0, 4).map((visit) => (
            <li key={visit.kind === "booked" ? visit.bookingId : visit.proposalId}>{visitRow(visit)}</li>
          ))}
        </Rows>
      )}
    </Widget>
  );
}

type ProviderAlertView = Extract<HomeAlertView, { kind: "provider_cancelled" }>;

function replacementLine(alert: ProviderAlertView): string {
  if (alert.rebooked) return "replacement booked";
  if (alert.replacementsReady === 0) return "finding a replacement…";
  return alert.replacementsReady === 1 ? "1 replacement ready · needs approval" : `${alert.replacementsReady} replacements ready · needs approval`;
}

/** The chat that handles a provider's cancellation, opened at its waiting card if there is one. */
export function providerAlertHref(alert: ProviderAlertView): string {
  if (alert.sessionId === null) return "/chat";
  return chatHref(alert.sessionId, alert.proposalId === null || alert.rebooked ? {} : { proposal: alert.proposalId });
}

function alertRow(alert: HomeAlertView, nowMs: number) {
  const since = <span className="text-xs text-fg-3 tabular-nums">{sinceLabel(alert.at, nowMs)}</span>;
  switch (alert.kind) {
    case "provider_cancelled": {
      const row = (
        <ListRow
          lead={
            alert.rebooked ? (
              <StatusMark kind="ok" label="Rebooked" className="w-20 flex-none" />
            ) : (
              <StatusMark kind="cancelled" label="Cancelled" className="w-20 flex-none" />
            )
          }
          title={`${alert.providerName} cancelled ${slotLabel(alert.slot.start)}`}
          meta={replacementLine(alert)}
          action={since}
        />
      );
      // The alert opens its chat, at the replacement's approval card when one is waiting.
      return alert.sessionId === null ? (
        row
      ) : (
        <Link href={providerAlertHref(alert)} className="block rounded-md hover:bg-surface-2">
          {row}
        </Link>
      );
    }
    case "booking_recovered":
      return (
        <Link href={chatHref(alert.sessionId)} className="block rounded-md hover:bg-surface-2">
          <ListRow
            lead={<StatusMark kind="ok" label="Recovered" className="w-20 flex-none" />}
            title={`${serviceLabel(alert.service)} booking confirmed after a check`}
            meta="the provider was slow to answer · verified booked"
            action={since}
          />
        </Link>
      );
    case "errand_failed":
      return (
        <Link href={chatHref(alert.sessionId)} className="block rounded-md hover:bg-surface-2">
          <ListRow
            lead={<StatusMark kind="cancelled" label="Failed" className="w-20 flex-none" />}
            title={alert.service === null ? "An errand stopped" : `${errandTitle(alert)} stopped`}
            meta="a run failed · open the chat to see where it stopped"
            action={since}
          />
        </Link>
      );
  }
}

export function Alerts({ summary, nowMs }: { readonly summary?: Summary; readonly nowMs: number }) {
  const alerts = summary?.alerts ?? [];
  return (
    <Widget icon="⚠" title="Alerts" count={summary === undefined ? undefined : { value: alerts.length, tone: "plain" }} busy={summary === undefined}>
      {summary === undefined ? (
        <LoadingRows />
      ) : alerts.length === 0 ? (
        <EmptyState message="No alerts. Provider cancellations and failed or recovered bookings show up here." />
      ) : (
        <Rows label="Recent alerts">
          {alerts.slice(0, 4).map((alert) => (
            <li key={alert.kind === "provider_cancelled" ? alert.alertId : `${alert.kind}:${alert.errandId}`}>{alertRow(alert, nowMs)}</li>
          ))}
        </Rows>
      )}
    </Widget>
  );
}

type Measure = "visits" | "spend";

export function BookingActivity({ summary, onStart }: { readonly summary?: Summary; readonly onStart: () => void }) {
  const [measure, setMeasure] = useState<Measure>("visits");
  const days = summary?.activity.days ?? [];
  const visits = days.reduce((sum, day) => sum + day.bookings, 0);
  const booked = days.reduce((sum, day) => sum + day.bookedInr, 0);
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  const today = summary?.activity.today;
  const range = first === undefined || last === undefined ? "" : `${dateLabel(first)} – ${dateLabel(last)}`;
  return (
    <Widget
      icon="▥"
      title="Bookings · 14 days"
      busy={summary === undefined}
      action={
        <SegmentedControl
          label="Chart shows"
          value={measure}
          onValueChange={setMeasure}
          items={[
            { value: "visits", label: "Visits" },
            { value: "spend", label: "₹" },
          ]}
        />
      }
    >
      {summary === undefined ? (
        <LoadingRows />
      ) : visits === 0 ? (
        <EmptyState message={`No visits booked ${range}.`} actionLabel="Start an errand" onAction={onStart} />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-semibold text-fg tabular-nums">{measure === "visits" ? visits : `₹${booked.toLocaleString("en-IN")}`}</span>
            <span className="text-xs text-fg-3">
              {measure === "visits" ? `visits · ₹${booked.toLocaleString("en-IN")} booked` : `booked · ${visits} visits`}
            </span>
          </div>
          <MiniBarChart
            values={days.map((day) => (measure === "visits" ? day.bookings : day.bookedInr))}
            current={days.findIndex((day) => day.date === today)}
            label={`${measure === "visits" ? "Visits" : "Rupees booked"} per day, ${range}; today is ${today === undefined ? "" : dateLabel(today)}`}
          />
          {/* Under the bars, one column per day: the first day, today (the seventh) and the last. */}
          <div aria-hidden className="mt-1 grid grid-cols-14 gap-1 text-xs whitespace-nowrap text-fg-3">
            <span className="col-start-1 col-end-4">{first === undefined ? "" : dateLabel(first)}</span>
            <span className="col-start-7 justify-self-center text-fg">today</span>
            <span className="col-start-12 col-end-15 justify-self-end">{last === undefined ? "" : dateLabel(last)}</span>
          </div>
        </>
      )}
    </Widget>
  );
}

export function MemoryWidget({ summary }: { readonly summary?: Summary }) {
  const facts = summary?.memory ?? [];
  return (
    <Widget
      icon="◎"
      title="Memory"
      count={summary === undefined ? undefined : { value: facts.length, tone: "plain" }}
      busy={summary === undefined}
      action={
        <span className="flex items-center gap-1.5">
          <Badge variant="tag">explicit</Badge>
          <Badge variant="inferred">inferred</Badge>
        </span>
      }
    >
      {summary === undefined ? (
        <LoadingRows />
      ) : facts.length === 0 ? (
        <EmptyState message="Nothing remembered yet. Tell the agent your usual area or budget and it will ask to keep it." />
      ) : (
        <>
          <ul aria-label="Remembered preferences" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {facts.map((fact) => (
              <li key={fact.id}>
                <MemoryChip origin={fact.status === "pending_confirmation" ? "inferred" : "explicit"}>
                  {fact.label} · {fact.display}
                  {fact.status === "pending_confirmation" ? "?" : ""}
                </MemoryChip>
              </li>
            ))}
          </ul>
          <Link href="/chat?rail=memory" className="mt-2 inline-block text-xs text-fg underline-offset-4 hover:underline">
            Open memory
          </Link>
        </>
      )}
    </Widget>
  );
}
