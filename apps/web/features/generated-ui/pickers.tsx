"use client";

import { useAuiState } from "@assistant-ui/react";
import { bindBookings, bookingMessage, modelText, pickMessage, rupees, slotLabel, slotMessage } from "@errand/client";
import type { PickOptionProps, ServiceChoiceProps } from "@errand/contracts";
import { FollowUpBlock, FollowUpItem } from "@openuidev/react-ui";
import { useState } from "react";

import { Money } from "@/components/money";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Photo, ServiceIcon } from "@/features/images";

import { useBookings, useGeneratedUiHost, useProviders, useServiceOptions } from "./bound-data";

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
  "flex w-full items-baseline justify-between gap-2 rounded-md border border-line bg-page px-3 py-2 text-left text-xs text-fg-2 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45 data-sent:border-accent-line data-sent:text-fg";

function Loading() {
  return (
    <div aria-busy className="my-3 rounded-panel border border-line bg-surface p-3">
      <Skeleton className="h-12" />
    </div>
  );
}

export function SlotPicker({ providerId, date }: { readonly providerId: string; readonly date?: string }) {
  const providers = useProviders([providerId]);
  const { disabled, sent, answer } = useAnswer();
  if (providers.status === "loading") return <Loading />;
  const provider = providers.status === "ready" ? providers.data[0] : undefined;
  if (provider === undefined) return <p className="my-2 text-xs text-fg-3">Slots aren't available for this provider.</p>;
  const slots = provider.freeSlots.filter((slot) => date === undefined || slot.start.startsWith(date));
  return (
    <section aria-label={`Free slots with ${provider.name}`} data-testid="slot-picker" className="my-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <p className="m-0 text-sm font-medium text-fg">Free slots with {provider.name}</p>
      {slots.length === 0 ? (
        <p className="m-0 text-xs text-fg-3">No free slot{date === undefined ? " this week" : " that day"}.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {slots.map((slot) => {
            const label = slotLabel(slot);
            const text = slotMessage(provider.name, label);
            return (
              <button key={slot.start} type="button" disabled={disabled} data-sent={sent === text || undefined} className={optionClass} onClick={() => answer(text)}>
                <span className="tabular-nums">{label}</span>
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
    <section aria-label={question} data-testid="pick-one" className="my-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <p className="m-0 text-sm font-medium text-fg">{question}</p>
      {options.map((option) => (
        <button key={option.label} type="button" disabled={disabled} data-sent={sent === option.label || undefined} className={optionClass} onClick={() => answer(pickMessage(option.label))}>
          <span>{option.label}</span>
          {modelText(option.detail) !== undefined && <span className="text-fg-3">{modelText(option.detail)}</span>}
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
          className="h-8 flex-1 rounded-md border border-line bg-page px-2 text-xs text-fg outline-none placeholder:text-fg-3 focus-visible:border-accent-line"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || own.trim() === ""}>
          Send
        </Button>
      </form>
    </section>
  );
}

/**
 * "Which AC service?": a photo card per kind of service. The model names option ids and labels; the
 * card's label, price, description and photo are the world's, by id. An id the world doesn't have
 * keeps the model's label beside a line icon, with no price and no photo.
 */
export function ServiceChoices({ question, choices }: { readonly question: string; readonly choices: readonly ServiceChoiceProps[] }) {
  const options = useServiceOptions();
  const { disabled, sent, answer } = useAnswer();
  if (options.status === "loading") return <Loading />;
  const byId = new Map(options.status === "ready" ? [...options.data.services, ...options.data.kinds].map((option) => [option.id, option]) : []);
  return (
    <section aria-label={question} data-testid="service-choices" className="my-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <p className="m-0 text-sm font-medium text-fg">{question}</p>
      <div className="grid grid-cols-3 gap-2">
        {choices.map((choice) => {
          const option = byId.get(choice.optionId);
          const label = option?.label ?? choice.label;
          return (
            <button
              key={choice.optionId}
              type="button"
              disabled={disabled}
              data-sent={sent === label || undefined}
              data-option-id={choice.optionId}
              onClick={() => answer(pickMessage(label))}
              className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-line-strong bg-page text-left text-fg hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45 data-sent:border-accent-line data-sent:bg-accent-wash data-sent:opacity-100"
            >
              <Photo imageKey={option?.image} ratio="landscape" fallback={<ServiceIcon service={option?.service} />} className="w-full" />
              <span className="flex flex-col gap-0.5 px-2.5 pt-2 pb-2.5">
                <span className="text-sm font-medium">{label}</span>
                {option !== undefined && (
                  <>
                    <span className="text-xs tabular-nums text-fg">
                      from <Money amount={option.fromPriceInr} />
                    </span>
                    <span className="text-xs text-fg-2">{option.description}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function BookingPicker({ question, bookingIds }: { readonly question: string; readonly bookingIds: readonly string[] }) {
  const bookings = useBookings();
  const { disabled, sent, answer } = useAnswer();
  if (bookings.status === "loading") return <Loading />;
  if (bookings.status === "failed") return <p className="my-2 text-xs text-fg-3">Your bookings aren't available right now.</p>;
  const bound = bindBookings(bookingIds, bookings.data);
  return (
    <section aria-label={question} data-testid="booking-picker" className="my-3 flex flex-col gap-2 rounded-panel border border-line bg-surface p-3">
      <p className="m-0 text-sm font-medium text-fg">{question}</p>
      {bound.map((booking) => {
        const text = bookingMessage(booking.providerName, slotLabel(booking.slot));
        return (
          <button key={booking.bookingId} type="button" disabled={disabled} data-sent={sent === text || undefined} className={optionClass} onClick={() => answer(text)}>
            <span>
              {booking.providerName} · <span className="tabular-nums">{slotLabel(booking.slot)}</span>
            </span>
            <span className="tabular-nums text-fg-3">
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
