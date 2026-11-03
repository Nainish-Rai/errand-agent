"use client";

import { useAuiState } from "@assistant-ui/react";
import { bindBookings, bookingMessage, modelText, pickMessage, rupees, slotLabel, slotMessage } from "@errand/client";
import type { PickOptionProps } from "@errand/contracts";
import { FollowUpBlock, FollowUpItem } from "@openuidev/react-ui";
import { useState } from "react";

import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";

import { useBookings, useGeneratedUiHost, useProviders } from "./bound-data";

// The asking components besides the form, and the next-step chips. Each tap sends one ordinary
// message as the person. Slots and bookings are read by id; only labels the person reads as
// options come from the model.

function useAnswer() {
  const { send } = useGeneratedUiHost();
  const running = useAuiState((state) => state.thread.isRunning);
  const [sent, setSent] = useState<string>();
  return {
    disabled: running || sent !== undefined,
    sent,
    answer: (text: string) => {
      setSent(text);
      void send(text);
    },
  };
}

const optionClass =
  "flex w-full items-baseline justify-between gap-2 rounded-md border border-edge bg-surface-canvas px-3 py-2 text-left text-label text-fg-body hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-45 data-sent:border-interactive data-sent:text-fg-emph";

function Loading() {
  return (
    <div aria-busy className="my-3 rounded-lg border border-edge bg-surface-card p-3">
      <Skeleton className="h-12" />
    </div>
  );
}

export function SlotPicker({ providerId, date }: { readonly providerId: string; readonly date?: string }) {
  const providers = useProviders([providerId]);
  const { disabled, sent, answer } = useAnswer();
  if (providers.status === "loading") return <Loading />;
  const provider = providers.status === "ready" ? providers.data[0] : undefined;
  if (provider === undefined) return <p className="my-2 text-label text-fg-meta">Slots aren't available for this provider.</p>;
  const slots = provider.freeSlots.filter((slot) => date === undefined || slot.start.startsWith(date));
  return (
    <section aria-label={`Free slots with ${provider.name}`} data-testid="slot-picker" className="my-3 flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
      <p className="m-0 text-panel font-medium text-fg-emph">Free slots with {provider.name}</p>
      {slots.length === 0 ? (
        <p className="m-0 text-label text-fg-meta">No free slot{date === undefined ? " this week" : " that day"}.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {slots.map((slot) => {
            const label = slotLabel(slot);
            const text = slotMessage(provider.name, label);
            return (
              <button key={slot.start} type="button" disabled={disabled} data-sent={sent === text || undefined} className={optionClass} onClick={() => answer(text)}>
                <span className="font-mono tabular-nums">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function PickOne({ question, options }: { readonly question: string; readonly options: readonly PickOptionProps[] }) {
  const { disabled, sent, answer } = useAnswer();
  const [own, setOwn] = useState("");
  return (
    <section aria-label={question} data-testid="pick-one" className="my-3 flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
      <p className="m-0 text-panel font-medium text-fg-emph">{question}</p>
      {options.map((option) => (
        <button key={option.label} type="button" disabled={disabled} data-sent={sent === option.label || undefined} className={optionClass} onClick={() => answer(pickMessage(option.label))}>
          <span>{option.label}</span>
          {modelText(option.detail) !== undefined && <span className="text-fg-meta">{modelText(option.detail)}</span>}
        </button>
      ))}
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (own.trim() !== "") answer(pickMessage(own.trim()));
        }}
      >
        <input
          aria-label="Something else"
          placeholder="Something else…"
          value={own}
          disabled={disabled}
          onChange={(event) => setOwn(event.target.value)}
          className="h-8 flex-1 rounded-md border border-edge bg-surface-canvas px-2 text-label text-fg-emph outline-none placeholder:text-fg-meta focus-visible:border-interactive"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || own.trim() === ""}>
          Send
        </Button>
      </form>
    </section>
  );
}

export function BookingPicker({ question, bookingIds }: { readonly question: string; readonly bookingIds: readonly string[] }) {
  const bookings = useBookings();
  const { disabled, sent, answer } = useAnswer();
  if (bookings.status === "loading") return <Loading />;
  if (bookings.status === "failed") return <p className="my-2 text-label text-fg-meta">Your bookings aren't available right now.</p>;
  const bound = bindBookings(bookingIds, bookings.data);
  return (
    <section aria-label={question} data-testid="booking-picker" className="my-3 flex flex-col gap-2 rounded-lg border border-edge bg-surface-card p-3">
      <p className="m-0 text-panel font-medium text-fg-emph">{question}</p>
      {bound.map((booking) => {
        const text = bookingMessage(booking.providerName, slotLabel(booking.slot));
        return (
          <button key={booking.bookingId} type="button" disabled={disabled} data-sent={sent === text || undefined} className={optionClass} onClick={() => answer(text)}>
            <span>
              {booking.providerName} · <span className="font-mono tabular-nums">{slotLabel(booking.slot)}</span>
            </span>
            <span className="font-mono tabular-nums text-fg-meta">
              {rupees(booking.priceInr)} · {booking.status}
            </span>
          </button>
        );
      })}
    </section>
  );
}

export function FollowUps({ suggestions }: { readonly suggestions: readonly string[] }) {
  const { disabled, answer } = useAnswer();
  const isLast = useAuiState((state) => state.message.isLast);
  if (!isLast || suggestions.length === 0) return null;
  return (
    <div aria-label="Suggested next steps" data-testid="follow-ups" className="my-2">
      <FollowUpBlock>
        {suggestions.map((suggestion) => (
          <FollowUpItem key={suggestion} text={suggestion} disabled={disabled} onClick={() => answer(suggestion)} />
        ))}
      </FollowUpBlock>
    </div>
  );
}

/**
 * A component whose data isn't served yet (review insights wait on ticket 09, inferred
 * preferences on ticket 11). The backend refuses programs that use them, so this only shows if a
 * stored program predates that rule; it says so instead of drawing guesses.
 */
export function NotYetAvailable({ what }: { readonly what: string }) {
  return <p className="my-2 text-label text-fg-meta">{what} aren't available yet.</p>;
}
