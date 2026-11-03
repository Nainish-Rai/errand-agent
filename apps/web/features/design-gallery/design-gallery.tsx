"use client";

// The /design route: every foundation and trust component in every state, in both themes side by
// side. The app-side twin of design-system/design-system-v3.html. Data here is sample data, not the API's.
import { ArrowUp, Bell, TriangleAlert } from "lucide-react";
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
  ["page", "page"],
  ["surface", "surface"],
  ["surface-2", "surface-2"],
  ["raised", "raised"],
  ["line-strong", "line-strong"],
  ["fg", "fg"],
  ["fg-2", "fg-2"],
  ["fg-3", "fg-3"],
  ["accent", "accent"],
  ["accent-wash", "accent-wash"],
  ["accent-line", "accent-line"],
  ["ink", "ink"],
  ["success", "success"],
  ["warn", "warn"],
  ["danger", "danger"],
] as const;

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section>
      <h2 className="m-0 mb-2 text-lg font-semibold text-fg">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Line({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Caption({ children }: { readonly children: ReactNode }) {
  return <p className="m-0 font-mono text-xs text-fg-3">{children}</p>;
}

function Swatches() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(66px,1fr))] gap-1">
      {swatches.map(([role, label]) => (
        <div key={role} className="overflow-hidden rounded-md border border-line bg-surface text-xs text-fg-3">
          <i className="block h-6.5" style={{ background: `var(--${role})` }} />
          <span className="block truncate px-1 py-0.5 font-mono">{label}</span>
        </div>
      ))}
    </div>
  );
}

function TypeScale() {
  const rows: readonly (readonly [string, ReactNode])[] = [
    ["3xl 36", <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">₹7,450</span>],
    ["xl 22", <span className="text-xl font-semibold tracking-tight text-fg">What errand should I handle?</span>],
    ["lg 18", <span className="text-lg font-semibold text-fg">Approve booking</span>],
    ["base 16", <span className="text-base text-fg">Three plumbers can come this week within your budget.</span>],
    ["sm 14", <span className="text-sm text-fg">Plumber for kitchen tap, this week</span>],
    ["xs 12", <span className="text-xs text-fg-3 tabular-nums">Thu 6 Nov · 09:00 · ₹899</span>],
    ["mono", <span className="font-mono text-xs text-fg-3">BK-7Q2M</span>],
  ];
  return (
    <div className="grid gap-2">
      {rows.map(([label, sample]) => (
        <div key={label} className="flex min-w-0 items-baseline gap-3">
          <span className="w-14 flex-none font-mono text-xs text-fg-3">{label}</span>
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
    <div data-theme={theme} className="grid min-w-0 content-start gap-5 rounded-panel border border-line bg-page p-4 text-sm text-fg-2">
      <div className="flex items-center justify-between text-sm font-semibold text-fg">
        <span>{theme === "dark" ? "Dark" : "Light"}</span>
        <span className="font-mono text-xs font-normal text-fg-3">data-theme=&quot;{theme}&quot;</span>
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
          <Button variant="primary" size="icon-xs" aria-label="Sending" loading>
            <ArrowUp />
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
            <span className="text-xl font-semibold text-fg tabular-nums">6</span>
            <span className="text-xs text-fg-3 tabular-nums">bookings · ₹7,450 spent</span>
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
        <ApprovalCard proposal={booking} provider={ravi} state={{ status: "voided", changes: [{ field: "price", from: 899, to: 1050 }] }} />
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
    <main className="min-h-dvh bg-surface-2">
      <header className="flex items-start justify-between gap-4 px-4 pt-4 text-fg">
        <div>
          <h1 className="m-0 text-xl font-semibold">Errand design system</h1>
          <p className="m-0 mt-1 text-fg-3">
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
