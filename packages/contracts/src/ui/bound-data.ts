import { z } from "zod";

import { IsoDateSchema } from "../world";

// The read-only data generated components bind to, besides GET /providers and GET /bookings:
// free slots per day (the slots-per-day chart) and spend per month (the spend chart).

/** GET /availability?providerIds=a,b: free slots per provider for today and the six days after, in IST. */
export const GetAvailabilityResponseSchema = z.object({
  days: z.array(
    z.object({
      date: IsoDateSchema,
      freeSlots: z.number().int().nonnegative(),
      byProvider: z.array(z.object({ providerId: z.string(), freeSlots: z.number().int().nonnegative() })),
    }),
  ),
  unknownProviderIds: z.array(z.string()),
});

/** GET /spend?months=6: this month and the months before it, oldest first. */
export const GetSpendResponseSchema = z.object({
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      spendInr: z.number().nonnegative(),
      bookings: z.number().int().nonnegative(),
    }),
  ),
});

export const MAX_SPEND_MONTHS = 12;

export type GetAvailabilityResponse = z.infer<typeof GetAvailabilityResponseSchema>;
export type GetSpendResponse = z.infer<typeof GetSpendResponseSchema>;
