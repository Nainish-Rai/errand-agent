"use client";

import type { GetHomeSummaryResponse, HomeAlertView, MemoryFactView, PendingApprovalView, UpcomingVisitView } from "@errand/contracts";
import { motion } from "motion/react";
import { ChevronRight, CircleAlert, CircleCheck, Hourglass } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { InferredValue } from "@/components/inferred-value";
import { AnimatedCount, Presence, Reveal, useLimeTiming } from "@/components/layout-motion";
import { Money } from "@/components/money";
import { Monogram } from "@/components/monogram";
import { Skeleton } from "@/components/skeleton";
import { Status } from "@/components/status";
import { Button, focusRing } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { errandDetails, errandTitle, serviceLabel, sinceLabel, slotLabel, stepLabel } from "./errand-words";

// Home's lists, as v3's "Home lists" draw them: Upcoming (bookings with their status), Alerts (what needs
// the person: approval cards, guesses to confirm, provider cancellations and runs that stopped, with a
// count) and, only while something runs, In progress. Each is a List of rows: a leading avatar or icon, a
// title over a description, a trailing status, time or action. Rows arrive with a 4px rise and leave by
// collapsing; a list that loads swaps its still skeleton for its rows or its empty line.

type Summary = GetHomeSummaryResponse;

function chatHref(sessionId: string, entry: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams(entry).toString();
  return `/chat/${encodeURIComponent(sessionId)}${query === "" ? "" : `?${query}`}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
}

/** v3's ListIcon: a line icon in a 40px circle; `danger` and `success` take their tint. */
function ListIcon({ tone = "neutral", children }: { readonly tone?: "neutral" | "danger" | "success" | "inferred"; readonly children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 flex-none place-items-center rounded-full [&_svg]:size-5",
        tone === "neutral" && "bg-surface-2 text-fg",
        tone === "danger" && "bg-danger-tint text-danger-text",
        tone === "success" && "bg-success-tint text-success-text",
        tone === "inferred" && "inferred border bg-page text-warn-text",
      )}
    >
      {children}
    </span>
  );
}

type RowProps = {
  readonly leading: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly trailing?: ReactNode;
  /** The whole row opens this; `trailing` should then not be interactive. */
  readonly href?: string;
};

/** v3's list row: 56px tall at least, a hairline between rows. */
function Row({ leading, title, description, trailing, href }: RowProps) {
  const body = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base leading-snug font-medium text-fg">{title}</span>
        <span className="truncate text-sm text-fg-3">{description}</span>
      </span>
      {trailing !== undefined && <span className="flex flex-none items-center gap-1 text-sm text-fg-2 tabular-nums">{trailing}</span>}
      {href !== undefined && <ChevronRight aria-hidden className="-mr-1 size-4 flex-none text-fg-3" />}
    </>
  );
  const row = "flex min-h-14 w-full items-center gap-3 py-3";
  return href === undefined ? (
    <div className={row}>{body}</div>
  ) : (
    <Link href={href} className={cn(row, focusRing, "-mx-2 w-[calc(100%+1rem)] rounded-field px-2 transition-colors duration-(--dur-instant) ease-out hover:bg-surface")}>
      {body}
    </Link>
  );
}

/** A list whose rows arrive and leave. Each child must be a keyed `Reveal as="li"`. */
function Rows({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col p-0 [&>li:not(:last-child)]:border-b [&>li:not(:last-child)]:border-line">
      <Presence>{children}</Presence>
    </ul>
  );
}

/** Still rows in the shape of the list, while it loads. */
function LoadingRows() {
  return (
    <div aria-hidden className="grid gap-4 py-3">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ children }: { readonly children: ReactNode }) {
  return <div className="grid justify-items-start gap-3 py-2 text-sm text-fg-2">{children}</div>;
}

type SectionProps = {
  readonly title: string;
  readonly loading: boolean;
  /** Beside the title, e.g. the Alerts count. */
  readonly aside?: ReactNode;
  /** Shown once loaded when there are no rows. */
  readonly empty: ReactNode;
  readonly hasRows: boolean;
  readonly children: ReactNode;
};

/** A titled list on home. Loading, empty and rows swap with one leaving before the next arrives. */
function Section({ title, loading, aside, empty, hasRows, children }: SectionProps) {
  const state = loading ? "loading" : hasRows ? "rows" : "empty";
  return (
    <section aria-label={title} aria-busy={loading || undefined} className="grid gap-1">
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-lg leading-tight font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      <Presence wait>
        <Reveal key={state} rise={state === "rows" ? 0 : 4}>
          {state === "loading" ? <LoadingRows /> : state === "rows" ? children : empty}
        </Reveal>
      </Presence>
    </section>
  );
}

function visitRow(visit: UpcomingVisitView) {
  const description = `${slotLabel(visit.slot.start)} · ${serviceLabel(visit.service)}`;
  const price = <Money amount={visit.priceInr} className="text-fg-3" />;
  if (visit.kind === "booked") {
    return (
      <Row
        leading={<Monogram initials={initials(visit.providerName)} className="size-10 border-0 bg-surface-2 text-sm text-fg" />}
        title={visit.providerName}
        description={
          <>
            {description} · {price} · <span className="font-mono text-xs">{visit.bookingId}</span>
          </>
        }
        trailing={<Status state="done" label="Booked" booked />}
      />
    );
  }
  return (
    <Row
      leading={<Monogram initials={initials(visit.providerName)} className="size-10 border-0 bg-surface-2 text-sm text-fg" />}
      title={visit.providerName}
      description={
        <>
          {description} · {price}
        </>
      }
      trailing={<Status state="running" label="Checking with provider" />}
      href={chatHref(visit.sessionId)}
    />
  );
}

export function UpcomingList({ summary, onStart }: { readonly summary?: Summary; readonly onStart: () => void }) {
  const upcoming = summary?.upcoming ?? [];
  return (
    <Section
      title="Upcoming"
      loading={summary === undefined}
      hasRows={upcoming.length > 0}
      empty={
        <EmptyLine>
          <p className="m-0">No upcoming bookings. A booking shows here once the provider confirms it.</p>
          <Button size="sm" variant="secondary" onClick={onStart}>
            Start an errand
          </Button>
        </EmptyLine>
      }
    >
      <Rows label="Upcoming visits">
        {upcoming.slice(0, 5).map((visit) => (
          <Reveal as="li" key={visit.kind === "booked" ? visit.bookingId : visit.proposalId}>
            {visitRow(visit)}
          </Reveal>
        ))}
      </Rows>
    </Section>
  );
}

export function InProgressList({ summary }: { readonly summary: Summary }) {
  return (
    <Section title="In progress" loading={false} hasRows empty={null}>
      <Rows label="Errands in progress">
        {summary.working.slice(0, 4).map((errand) => (
          <Reveal as="li" key={errand.errandId}>
            <Row
              leading={<ListIcon>{errand.waitingOn === "person" ? <Hourglass /> : <CircleCheck />}</ListIcon>}
              title={errandTitle(errand)}
              description={errandDetails(errand)}
              trailing={
                errand.waitingOn === "person" ? <Status state="queued" label={stepLabel(errand.state)} /> : <Status state="running" label={stepLabel(errand.state)} />
              }
              href={chatHref(errand.sessionId)}
            />
          </Reveal>
        ))}
      </Rows>
    </Section>
  );
}

function holdLeft(seconds: number): string {
  return seconds >= 60 ? `hold ${Math.floor(seconds / 60)}m left` : `hold ${seconds}s left`;
}

type ProviderAlertView = Extract<HomeAlertView, { kind: "provider_cancelled" }>;

function replacementLine(alert: ProviderAlertView): string {
  if (alert.rebooked) return "Replacement booked";
  if (alert.replacementsReady === 0) return "Finding a replacement…";
  return alert.replacementsReady === 1 ? "1 replacement ready · needs your approval" : `${alert.replacementsReady} replacements ready · needs your approval`;
}

/** The chat that handles a provider's cancellation, opened at its waiting card if there is one. */
export function providerAlertHref(alert: ProviderAlertView): string {
  if (alert.sessionId === null) return "/chat";
  return chatHref(alert.sessionId, alert.proposalId === null || alert.rebooked ? {} : { proposal: alert.proposalId });
}

function approvalRow(approval: PendingApprovalView) {
  return (
    <Row
      leading={
        <ListIcon>
          <Hourglass />
        </ListIcon>
      }
      title={`Approve booking · ${approval.providerName}`}
      description={
        <>
          {slotLabel(approval.slot.start)} · <Money amount={approval.priceInr} /> · {holdLeft(approval.holdSecondsLeft)}
        </>
      }
      trailing={
        <Button asChild size="sm" variant="secondary">
          <Link href={chatHref(approval.sessionId, { proposal: approval.proposalId })} aria-label={`Review approval: ${approval.providerName}`}>
            Review
          </Link>
        </Button>
      }
    />
  );
}

/** A guess to confirm: dashed, a question, and never drawn like a fact. Confirm opens the memory sheet. */
function guessRow(fact: MemoryFactView, onOpenMemory: () => void) {
  return (
    <Row
      leading={
        <ListIcon tone="inferred">
          <CircleAlert />
        </ListIcon>
      }
      title={
        <span className="inline-flex items-baseline gap-1.5">
          Confirm {fact.label.toLowerCase()} <InferredValue label="inferred">{fact.display}</InferredValue>?
        </span>
      }
      description="A guess · not used until you confirm it"
      trailing={
        <Button size="sm" variant="secondary" aria-haspopup="dialog" aria-label={`Confirm in memory: ${fact.label} ${fact.display}`} onClick={onOpenMemory}>
          Confirm
        </Button>
      }
    />
  );
}

function alertRow(alert: HomeAlertView, nowMs: number) {
  const since = <span className="text-xs text-fg-3">{sinceLabel(alert.at, nowMs)}</span>;
  switch (alert.kind) {
    case "provider_cancelled":
      return (
        <Row
          leading={<ListIcon tone={alert.rebooked ? "success" : "danger"}>{alert.rebooked ? <CircleCheck /> : <CircleAlert />}</ListIcon>}
          title={`${alert.providerName} cancelled ${slotLabel(alert.slot.start)}`}
          description={replacementLine(alert)}
          trailing={
            <>
              <Status state={alert.rebooked ? "done" : "canceled"} label={alert.rebooked ? "Rebooked" : "Cancelled"} />
              {since}
            </>
          }
          // The alert opens its chat, at the replacement's approval card when one is waiting.
          {...(alert.sessionId === null ? {} : { href: providerAlertHref(alert) })}
        />
      );
    case "booking_recovered":
      return (
        <Row
          leading={
            <ListIcon tone="success">
              <CircleCheck />
            </ListIcon>
          }
          title={`${serviceLabel(alert.service)} booking confirmed after a check`}
          description="The provider was slow to answer · verified booked"
          trailing={since}
          href={chatHref(alert.sessionId)}
        />
      );
    case "errand_failed":
      return (
        <Row
          leading={
            <ListIcon tone="danger">
              <CircleAlert />
            </ListIcon>
          }
          title={alert.service === null ? "An errand stopped" : `${errandTitle(alert)} stopped`}
          description="A run failed · open the chat to see where it stopped"
          trailing={since}
          href={chatHref(alert.sessionId)}
        />
      );
  }
}

function alertKey(alert: HomeAlertView): string {
  return alert.kind === "provider_cancelled" ? alert.alertId : `${alert.kind}:${alert.errandId}`;
}

/** How many rows need the person: approval cards, guesses, and alerts not yet dealt with. */
function needingCount(summary: Summary): number {
  return summary.waiting.approvals.length + summary.waiting.facts.length + summary.counts.alerts;
}

/** The danger count beside "Alerts": it fades in when something needs the person and its figure slides. */
function NeedsYouBadge({ count }: { readonly count: number }) {
  const timing = useLimeTiming();
  return (
    <Presence>
      {count > 0 && (
        <motion.span
          key="count"
          className="inline-flex h-6 items-center gap-1 rounded-control bg-danger-tint px-2.5 text-xs font-medium text-danger-text"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: timing.fast }}
          exit={{ opacity: 0, transition: timing.leave }}
        >
          <AnimatedCount value={count} />
          <span>need you</span>
        </motion.span>
      )}
    </Presence>
  );
}

export function AlertsList({ summary, nowMs, onOpenMemory }: { readonly summary?: Summary; readonly nowMs: number; readonly onOpenMemory: () => void }) {
  const approvals = summary?.waiting.approvals ?? [];
  const facts = summary?.waiting.facts ?? [];
  const alerts = summary?.alerts ?? [];
  return (
    <Section
      title="Alerts"
      loading={summary === undefined}
      aside={summary === undefined ? undefined : <NeedsYouBadge count={needingCount(summary)} />}
      hasRows={approvals.length + facts.length + alerts.length > 0}
      empty={
        <EmptyLine>
          <p className="m-0">No alerts right now. Approval cards, guesses to confirm and provider cancellations show up here.</p>
        </EmptyLine>
      }
    >
      <Rows label="Recent alerts">
        {approvals.map((approval) => (
          <Reveal as="li" key={`approval:${approval.proposalId}`}>
            {approvalRow(approval)}
          </Reveal>
        ))}
        {facts.map((fact) => (
          <Reveal as="li" key={`fact:${fact.id}`}>
            {guessRow(fact, onOpenMemory)}
          </Reveal>
        ))}
        {alerts.slice(0, 4).map((alert) => (
          <Reveal as="li" key={alertKey(alert)}>
            {alertRow(alert, nowMs)}
          </Reveal>
        ))}
      </Rows>
    </Section>
  );
}
