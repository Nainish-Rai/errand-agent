"use client";

// The /design route: every foundation and trust component in every state, in both themes side by
// side. The app-side twin of design-system/gallery.html. Data here is sample data, not the API's.
import { Bell, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FilterChip, MemoryChip, SuggestionChip } from "@/components/chip";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { InferredValue } from "@/components/inferred-value";
import { Kbd } from "@/components/kbd";
import { Monogram } from "@/components/monogram";
import { Skeleton } from "@/components/skeleton";
import { StatusMark } from "@/components/status-mark";
import { SegmentedControl, UnderlineTabs } from "@/components/tabs";
import type { Theme } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Toast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListRow, MiniBarChart, NeedsYouDot, Widget } from "@/components/widget";
import {
  ApprovalCard,
  BookingReceipt,
  ForgottenFactRow,
  InferredFactPrompt,
  MemoryFactRow,
  ProviderCancelledAlert,
  VerificationBanner,
  type ApprovalProposal,
  type ApprovalProvider,
} from "@/features/trust";

const ravi: ApprovalProvider = { name: "Ravi Plumbing", initials: "RP", tone: 1, rating: 4.7 };
const booking: ApprovalProposal = {
  kind: "book",
  service: "Kitchen tap repair",
  slot: "Thu 6 Nov · 09:00",
  price: 899,
  priceNote: "incl. visit fee",
  address: "Koramangala, Bengaluru",
  cancellationTerms: "Free up to 2 hours before; ₹99 after.",
};
const cancellation: ApprovalProposal = { kind: "cancel", service: "Deep clean", slot: "Fri 14 Nov · 11:00", bookingId: "BK-3H8D", fee: 150 };
const reschedule: ApprovalProposal = {
  kind: "reschedule",
  service: "Kitchen tap repair",
  fromSlot: "Thu 6 Nov · 09:00",
  toSlot: "Fri 7 Nov · 16:00",
  price: 899,
};
const receipt = { provider: "Ravi Plumbing", slot: "Thu 6 Nov · 09:00", price: 899 };
const bookingsPerDay = [2, 4.5, 1, 0, 3, 6, 2.5, 0.5, 4, 8, 3.5, 0, 5.5, 9];
const ranges = [
  { value: "14d", label: "14 days" },
  { value: "month", label: "Month" },
] as const;

const swatches = [
  ["surface-well", "well"],
  ["surface-canvas", "canvas"],
  ["surface-card", "card"],
  ["surface-raised", "raised"],
  ["edge-strong", "edge-strong"],
  ["fg-emph", "fg-emph"],
  ["fg-body", "fg-body"],
  ["fg-meta", "fg-meta"],
  ["interactive", "interactive"],
  ["ok", "ok"],
  ["warn", "warn"],
  ["err", "err"],
  ["brand", "brand"],
] as const;

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section>
      <h2 className="m-0 mb-2 text-meta font-medium tracking-[.06em] text-fg-meta uppercase">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Line({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Caption({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 font-mono text-meta text-fg-meta">{children}</p>;
}

function Swatches() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(66px,1fr))] gap-1">
      {swatches.map(([role, label]) => (
        <div key={role} className="overflow-hidden rounded-md border border-edge bg-surface-card text-meta text-fg-meta">
          <i className="block h-6.5" style={{ background: `var(--${role})` }} />
          <span className="block truncate px-1 py-0.5 font-mono">{label}</span>
        </div>
      ))}
      <div className="overflow-hidden rounded-md border border-edge bg-surface-card text-meta text-fg-meta">
        <i className="flex h-6.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span key={n} className="flex-1" style={{ background: `var(--cat-${n})` }} />
          ))}
        </i>
        <span className="block truncate px-1 py-0.5 font-mono">cat-1…6</span>
      </div>
    </div>
  );
}

function TypeScale() {
  const rows: readonly (readonly [string, ReactNode])[] = [
    ["kpi 22", <span className="font-mono text-kpi font-semibold text-fg-emph tabular-nums">₹7,450</span>],
    ["title 19", <span className="text-title font-semibold text-fg-emph">What errand should I handle?</span>],
    ["panel 14", <span className="text-panel text-fg-emph">Approve booking</span>],
    ["body 12", <span className="text-body text-fg-emph">Plumber for kitchen tap, this week</span>],
    ["mono 10", <span className="font-mono text-meta text-fg-meta">Thu 6 Nov · 09:00 · ₹899 · BK-7Q2M</span>],
  ];
  return (
    <div className="grid gap-2">
      {rows.map(([label, sample]) => (
        <div key={label} className="flex min-w-0 items-baseline gap-3">
          <span className="w-14 flex-none font-mono text-meta text-fg-meta">{label}</span>
          {sample}
        </div>
      ))}
    </div>
  );
}

function Panel({ theme }: { readonly theme: Theme }) {
  const [tab, setTab] = useState<"new" | "running">("new");
  const [range, setRange] = useState<"14d" | "month">("14d");

  return (
    <div data-theme={theme} className="grid min-w-0 content-start gap-5 rounded-lg border border-edge bg-surface-canvas p-4 text-body text-fg-body">
      <div className="flex items-center justify-between text-panel font-semibold text-fg-emph">
        <span>{theme === "dark" ? "Dark" : "Light"}</span>
        <span className="font-mono text-meta font-normal text-fg-meta">data-theme=&quot;{theme}&quot;</span>
      </div>

      <Section title="Surfaces · text · tones">
        <Swatches />
      </Section>

      <Section title="Type">
        <TypeScale />
      </Section>

      <Section title="Buttons">
        <Line>
          <Button variant="primary">Choose</Button>
          <Button variant="secondary">Other options</Button>
          <Button variant="ghost">Decline</Button>
          <Button variant="danger">Cancel booking</Button>
        </Line>
        <Line>
          <Button variant="secondary" className="outline-2 outline-offset-2 outline-ring">
            Focus ring
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="primary" loading>
            Saving…
          </Button>
          <Button size="sm">Review</Button>
          <IconButton label="Notifications" icon={<Bell />} badge={{ value: 2, tone: "count" }} />
          <IconButton label="Alerts" icon={<TriangleAlert />} badge={{ value: 1, tone: "alert" }} />
        </Line>
      </Section>

      <Section title="Chips · badges · status">
        <Line>
          <FilterChip icon="📍" value="Koramangala" />
          <FilterChip icon="₹" value="Under ₹1,500" selected />
          <FilterChip icon="◷" value="This week" disabled />
          <SuggestionChip>Plumber this week</SuggestionChip>
        </Line>
        <Line>
          <MemoryChip origin="explicit">Area · Koramangala</MemoryChip>
          <MemoryChip origin="inferred">Prefers mornings?</MemoryChip>
          <Badge variant="count">2</Badge>
          <Badge variant="alert">1</Badge>
          <Badge variant="tag">explicit</Badge>
          <Badge variant="inferred">inferred</Badge>
          <Badge variant="verified">verified</Badge>
        </Line>
        <Line>
          <InferredValue label="estimated">~₹0.42</InferredValue>
          <InferredValue label="heuristic score">0.82</InferredValue>
        </Line>
        <Line>
          <StatusMark kind="ok" label="Booked" />
          <StatusMark kind="checking" label="Checking" />
          <StatusMark kind="replacing" label="Replacing" />
          <StatusMark kind="cancelled" label="Cancelled" />
          <StatusMark kind="needs-you" label="Needs you" />
          <StatusMark kind="expired" label="Expired" />
        </Line>
      </Section>

      <Section title="Navigation · feedback">
        <UnderlineTabs
          label="Composer"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "new", label: "New errand" },
            { value: "running", label: "Running", count: 1 },
          ]}
        />
        <Line>
          <SegmentedControl label="Range" value={range} onValueChange={setRange} items={ranges} />
          <Kbd>⌘K</Kbd>
          <Monogram initials="RP" tone={1} />
          <Monogram initials="CA" tone={3} />
          <Monogram initials="SK" tone={4} />
        </Line>
        <Toast tone="ok">Booking approved · checking with the provider</Toast>
        <Toast tone="info">Ravi Plumbing replied · slot held for 10 minutes</Toast>
        <Toast tone="err" action={<Button size="sm">Retry</Button>}>
          Couldn&apos;t reach the provider
        </Toast>
        <Widget title="Upcoming bookings" busy>
          <div className="grid gap-2">
            <Skeleton className="w-3/5" />
            <Skeleton className="w-[85%]" />
            <Skeleton className="w-2/5" />
          </div>
        </Widget>
        <EmptyState message="No bookings yet." actionLabel="Start an errand" />
      </Section>

      <Section title="Widgets · list rows">
        <Widget icon="◷" title="Waiting on you" count={{ value: 2, tone: "needs-you" }}>
          <ListRow lead={<NeedsYouDot />} title="Approve booking · Ravi Plumbing" meta="Thu 6 Nov · 09:00 · ₹899" action={<Button size="sm">Review</Button>} />
          <ListRow lead={<NeedsYouDot />} title="Confirm “prefers mornings”?" meta="inferred from 3 bookings" action={<Button size="sm">Confirm</Button>} />
        </Widget>
        <Widget icon="▥" title="Bookings" action={<SegmentedControl label="Range" value={range} onValueChange={setRange} items={ranges} />}>
          <Line>
            <span className="font-mono text-kpi font-semibold text-fg-emph tabular-nums">6</span>
            <span className="font-mono text-meta text-fg-meta">bookings · ₹7,450 spent</span>
          </Line>
          <MiniBarChart values={bookingsPerDay} label="Bookings per day over the last 14 days" />
        </Widget>
      </Section>

      <Section title="Approval card · fixed, never generated">
        <Caption>pending</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "pending", holdLeft: "8:42 left" }} />
        <Caption>approving</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "approving" }} />
        <Caption>approved</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "approved" }} />
        <Caption>voided · old price beside new</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "voided", change: { field: "price", from: 899, to: 1050 } }} />
        <Caption>expired</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "expired", expiredAt: "09:12" }} />
        <Caption>declined · the hold is released</Caption>
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "declined" }} />
        <Caption>cancel · shows the fee</Caption>
        <ApprovalCard proposal={cancellation} provider={{ name: "Sparkle Cleaning", initials: "SC", tone: 4, rating: 4.4 }} state={{ status: "pending" }} />
        <Caption>reschedule · old time beside new</Caption>
        <ApprovalCard proposal={reschedule} provider={ravi} state={{ status: "pending", holdLeft: "9:58 left" }} />
      </Section>

      <Section title="Receipts · banners · alerts">
        <BookingReceipt booking={receipt} state={{ status: "booked", bookingId: "BK-7Q2M" }} />
        <BookingReceipt booking={receipt} state={{ status: "checking" }} />
        <BookingReceipt booking={receipt} state={{ status: "failed", reason: "The provider turned the slot down." }} onSeeOptions={() => undefined} />
        <VerificationBanner promise="The booking may already have gone through. I'll update you within 2 minutes, and I won't book twice." />
        <ProviderCancelledAlert provider="Sparkle" service="deep clean" slot="Fri 14 Nov 11:00" replacementsReady={2} onSeeOptions={() => undefined} />
        <ProviderCancelledAlert provider="Sparkle" service="deep clean" slot="Fri 14 Nov 11:00" replacementsReady={0} />
      </Section>

      <Section title="Memory">
        <MemoryFactRow fact={{ statement: "Area · Koramangala", origin: "explicit", source: "you said · 2 Nov" }} />
        <MemoryFactRow fact={{ statement: "Prefers mornings", origin: "inferred", source: "inferred from 3 bookings" }} />
        <InferredFactPrompt question="Prefers mornings?" source="inferred from 3 bookings" />
        <ForgottenFactRow statement="Plumbing budget ≤ ₹1,000" forgottenOn="1 Nov" />
      </Section>
    </div>
  );
}

export function DesignGallery() {
  return (
    <main className="min-h-dvh bg-surface-well">
      <header className="flex items-start justify-between gap-4 px-4 pt-4 text-fg-emph">
        <div>
          <h1 className="m-0 text-title font-semibold">Errand design system</h1>
          <p className="m-0 mt-1 text-fg-meta">
            Every component, dark and light, reading only from <span className="font-mono">@errand/design-tokens</span>. The page
            follows your theme; the two panels are fixed.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3 p-4">
        <Panel theme="dark" />
        <Panel theme="light" />
      </div>
    </main>
  );
}
