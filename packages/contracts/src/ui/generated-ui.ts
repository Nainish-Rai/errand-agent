import { z } from "zod";

import { IsoDateSchema } from "../world";

// The generated-UI component library (OpenUI): every component the model may write, as Zod props.
// The model fills in IDs, a short highlight and a one-line reason; the client fills in every fact
// (price, rating, slot, status, photos) from the read-only API by those IDs. There is no approve,
// confirm or pay component, and no component takes an action from the model: what a button does
// is fixed in the component's code.
//
// Key order is the positional order in OpenUI Lang (`ProviderChoice("prv_1", "Same-day", "…")`),
// so never reorder keys. Descriptions are part of the model's instructions: keep them short.

const ProviderIdSchema = z.string().describe("A providerId from search_providers");

export const ProviderChoicePropsSchema = z.object({
  providerId: ProviderIdSchema,
  highlight: z.string().describe("1-3 word tag, e.g. Same-day, Gas refill included"),
  reason: z.string().describe("One short line on why it suits them. No prices, ratings or times: the card shows those"),
});

export const ProviderChoicesPropsSchema = z.object({
  choices: z.array(ProviderChoicePropsSchema).describe("Best first; up to 3 show in a row, more in a carousel"),
  title: z.string().optional(),
});

export const PriceChartPropsSchema = z.object({
  providerIds: z.array(ProviderIdSchema).describe("The options being compared, 4 or more"),
  title: z.string().optional(),
});

export const SlotsPerDayChartPropsSchema = z.object({
  providerIds: z.array(ProviderIdSchema).describe("Providers whose free slots are counted per day this week"),
  title: z.string().optional(),
});

export const SpendChartPropsSchema = z.object({
  months: z.number().int().min(1).max(12).describe("How many months back, counting this one"),
  title: z.string().optional(),
});

export const ProviderDetailsPropsSchema = z.object({
  providerId: ProviderIdSchema,
});

export const ReviewInsightPropsSchema = z.object({
  providerId: ProviderIdSchema,
});

export const SlotPickerPropsSchema = z.object({
  providerId: ProviderIdSchema,
  date: IsoDateSchema.optional().describe("Only this day's slots, YYYY-MM-DD"),
});

export const PickOptionPropsSchema = z.object({
  label: z.string().describe("What tapping it says, e.g. The kitchen tap"),
  detail: z.string().optional(),
});

export const PickOnePropsSchema = z.object({
  question: z.string(),
  options: z.array(PickOptionPropsSchema),
});

export const BookingPickerPropsSchema = z.object({
  question: z.string(),
  bookingIds: z.array(z.string().describe("A bookingId from the person's bookings")),
});

export const PreferenceCardPropsSchema = z.object({
  factIds: z.array(z.string().describe("An inferred memory fact id")),
});

export const AskFieldSchema = z.enum(["service", "area", "timeWindow"]);

export const AskFormPropsSchema = z.object({
  fields: z.array(AskFieldSchema).describe("Only the fields update_errand's question names"),
  title: z.string().optional(),
});

export const FollowUpsPropsSchema = z.object({
  suggestions: z.array(z.string()).describe("2-4 short next steps the person can tap, e.g. Show evening slots"),
});

export const StackPropsSchema = z.object({
  items: z.array(
    z.union([
      ProviderChoicesPropsSchema,
      PriceChartPropsSchema,
      SlotsPerDayChartPropsSchema,
      SpendChartPropsSchema,
      ProviderDetailsPropsSchema,
      ReviewInsightPropsSchema,
      SlotPickerPropsSchema,
      PickOnePropsSchema,
      BookingPickerPropsSchema,
      PreferenceCardPropsSchema,
      AskFormPropsSchema,
      FollowUpsPropsSchema,
    ]),
  ),
});

/** The program's root statement: `root = Stack([...])`. */
export const GENERATED_UI_ROOT = "Stack";

export interface GeneratedUiComponentContract {
  readonly name: string;
  readonly description: string;
  readonly props: z.ZodObject;
}

/**
 * Every component, in the order the prompt lists them. Which are offered to the model, and which
 * are for asking rather than showing, is core's rule table (src/core/generated-ui/library-rules.ts);
 * a unit test keeps the two lists the same.
 */
export const GENERATED_UI_COMPONENTS: readonly GeneratedUiComponentContract[] = [
  { name: "Stack", description: "The root: the items in order", props: StackPropsSchema },
  { name: "ProviderChoices", description: "Photo cards to pick a provider; each has Choose and Details", props: ProviderChoicesPropsSchema },
  { name: "ProviderChoice", description: "One card in ProviderChoices", props: ProviderChoicePropsSchema },
  { name: "PriceChart", description: "Bar chart of the providers' prices", props: PriceChartPropsSchema },
  { name: "SlotsPerDayChart", description: "Bar chart of free slots per day this week; tapping a day picks it", props: SlotsPerDayChartPropsSchema },
  { name: "SpendChart", description: "The person's spend and bookings per month", props: SpendChartPropsSchema },
  { name: "ProviderDetails", description: "One provider's photos of past work, about and terms", props: ProviderDetailsPropsSchema },
  { name: "ReviewInsight", description: "Strengths and red flags from a provider's reviews", props: ReviewInsightPropsSchema },
  { name: "SlotPicker", description: "Asks which free slot of one provider", props: SlotPickerPropsSchema },
  { name: "PickOne", description: "Asks to pick one of a few options", props: PickOnePropsSchema },
  { name: "PickOption", description: "One option in PickOne", props: PickOptionPropsSchema },
  { name: "BookingPicker", description: "Asks which of the person's bookings they mean", props: BookingPickerPropsSchema },
  { name: "PreferenceCard", description: "Asks to keep or dismiss inferred preferences", props: PreferenceCardPropsSchema },
  { name: "AskForm", description: "Asks for the missing errand details with chips and a date picker", props: AskFormPropsSchema },
  { name: "FollowUps", description: "Tap-to-send next steps", props: FollowUpsPropsSchema },
];

export type ProviderChoiceProps = z.infer<typeof ProviderChoicePropsSchema>;
export type ProviderChoicesProps = z.infer<typeof ProviderChoicesPropsSchema>;
export type PriceChartProps = z.infer<typeof PriceChartPropsSchema>;
export type SlotsPerDayChartProps = z.infer<typeof SlotsPerDayChartPropsSchema>;
export type SpendChartProps = z.infer<typeof SpendChartPropsSchema>;
export type ProviderDetailsProps = z.infer<typeof ProviderDetailsPropsSchema>;
export type ReviewInsightProps = z.infer<typeof ReviewInsightPropsSchema>;
export type SlotPickerProps = z.infer<typeof SlotPickerPropsSchema>;
export type PickOptionProps = z.infer<typeof PickOptionPropsSchema>;
export type PickOneProps = z.infer<typeof PickOnePropsSchema>;
export type BookingPickerProps = z.infer<typeof BookingPickerPropsSchema>;
export type PreferenceCardProps = z.infer<typeof PreferenceCardPropsSchema>;
export type AskField = z.infer<typeof AskFieldSchema>;
export type AskFormProps = z.infer<typeof AskFormPropsSchema>;
export type FollowUpsProps = z.infer<typeof FollowUpsPropsSchema>;
export type StackProps = z.infer<typeof StackPropsSchema>;
