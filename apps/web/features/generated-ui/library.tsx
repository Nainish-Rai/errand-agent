"use client";

import {
  AskFormPropsSchema,
  BookingPickerPropsSchema,
  FollowUpsPropsSchema,
  GENERATED_UI_COMPONENTS,
  GENERATED_UI_ROOT,
  PickOnePropsSchema,
  PickOptionPropsSchema,
  PreferenceCardPropsSchema,
  PriceChartPropsSchema,
  ProviderChoicePropsSchema,
  ProviderChoicesPropsSchema,
  ProviderDetailsPropsSchema,
  ReviewInsightPropsSchema,
  SlotPickerPropsSchema,
  SlotsPerDayChartPropsSchema,
  SpendChartPropsSchema,
  StackPropsSchema,
  type ProviderChoiceProps,
} from "@errand/contracts";
import { repeatsSearchCards } from "@errand/client";
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import type { ReactNode } from "react";

import { AskForm } from "./ask-form";
import { PriceChart, SlotsPerDayChart, SpendChart } from "./charts";
import { PreferenceCard, ReviewInsight } from "./insight-and-preferences";
import { BookingPicker, FollowUps, PickOne, SlotPicker } from "./pickers";
import { useProvidersShownBySearch } from "./bound-data";
import { ProviderChoiceCards } from "./provider-choice-cards";
import { ProviderDetailsPanel } from "./provider-details";

// The OpenUI library the chat renders generated programs with: one renderer per component of the
// contract (packages/contracts ui/generated-ui.ts), the same schemas the backend parses and the
// model is prompted with. No renderer here has an approve, confirm or pay action, and none runs an
// action the model wrote: every button's behaviour is in its component.

function description(name: string): string {
  return GENERATED_UI_COMPONENTS.find((component) => component.name === name)?.description ?? name;
}

/** A sub-component (a card inside ProviderChoices) renders through its parent, never alone. */
function asProps<T>(value: unknown): T | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const element = value as { readonly type?: unknown; readonly props?: unknown };
  return element.type === "element" ? (element.props as T) : undefined;
}

const Stack = defineComponent({
  name: GENERATED_UI_ROOT,
  description: description(GENERATED_UI_ROOT),
  props: StackPropsSchema,
  component: ({ props, renderNode }) => <div className="flex flex-col">{renderNode(props.items) as ReactNode}</div>,
});

/** Provider cards, unless this reply's search already shows every one of them (no provider twice). */
function ModelChoiceCards({ choices, title }: { readonly choices: readonly ProviderChoiceProps[]; readonly title?: string }) {
  const shownBySearch = useProvidersShownBySearch();
  if (repeatsSearchCards(choices.map((choice) => choice.providerId), shownBySearch)) return null;
  return <ProviderChoiceCards choices={choices} {...(title === undefined ? {} : { title })} />;
}

const ProviderChoices = defineComponent({
  name: "ProviderChoices",
  description: description("ProviderChoices"),
  props: ProviderChoicesPropsSchema,
  component: ({ props }) => (
    <ModelChoiceCards
      choices={props.choices.flatMap((choice) => {
        const bound = asProps<ProviderChoiceProps>(choice) ?? choice;
        return typeof bound.providerId === "string" ? [bound] : [];
      })}
      {...(props.title === undefined ? {} : { title: props.title })}
    />
  ),
});

const ProviderChoice = defineComponent({
  name: "ProviderChoice",
  description: description("ProviderChoice"),
  props: ProviderChoicePropsSchema,
  component: ({ props }) => <ModelChoiceCards choices={[props]} />,
});

const PickOption = defineComponent({
  name: "PickOption",
  description: description("PickOption"),
  props: PickOptionPropsSchema,
  component: () => null,
});

export const generatedUiLibrary = createLibrary({
  root: GENERATED_UI_ROOT,
  components: [
    Stack,
    ProviderChoices,
    ProviderChoice,
    defineComponent({
      name: "PriceChart",
      description: description("PriceChart"),
      props: PriceChartPropsSchema,
      component: ({ props }) => <PriceChart providerIds={props.providerIds} {...(props.title === undefined ? {} : { title: props.title })} />,
    }),
    defineComponent({
      name: "SlotsPerDayChart",
      description: description("SlotsPerDayChart"),
      props: SlotsPerDayChartPropsSchema,
      component: ({ props }) => <SlotsPerDayChart providerIds={props.providerIds} {...(props.title === undefined ? {} : { title: props.title })} />,
    }),
    defineComponent({
      name: "SpendChart",
      description: description("SpendChart"),
      props: SpendChartPropsSchema,
      component: ({ props }) => <SpendChart months={props.months} {...(props.title === undefined ? {} : { title: props.title })} />,
    }),
    defineComponent({
      name: "ProviderDetails",
      description: description("ProviderDetails"),
      props: ProviderDetailsPropsSchema,
      component: ({ props }) => <ProviderDetailsPanel providerId={props.providerId} />,
    }),
    defineComponent({
      name: "ReviewInsight",
      description: description("ReviewInsight"),
      props: ReviewInsightPropsSchema,
      component: ({ props }) => <ReviewInsight providerId={props.providerId} />,
    }),
    defineComponent({
      name: "SlotPicker",
      description: description("SlotPicker"),
      props: SlotPickerPropsSchema,
      component: ({ props }) => <SlotPicker providerId={props.providerId} {...(props.date === undefined ? {} : { date: props.date })} />,
    }),
    defineComponent({
      name: "PickOne",
      description: description("PickOne"),
      props: PickOnePropsSchema,
      component: ({ props }) => (
        <PickOne
          question={props.question}
          options={props.options.flatMap((option) => {
            const bound = asProps<{ label: string; detail?: string }>(option) ?? option;
            return typeof bound.label === "string" ? [bound] : [];
          })}
        />
      ),
    }),
    PickOption,
    defineComponent({
      name: "BookingPicker",
      description: description("BookingPicker"),
      props: BookingPickerPropsSchema,
      component: ({ props }) => <BookingPicker question={props.question} bookingIds={props.bookingIds} />,
    }),
    defineComponent({
      name: "PreferenceCard",
      description: description("PreferenceCard"),
      props: PreferenceCardPropsSchema,
      component: ({ props }) => <PreferenceCard factIds={props.factIds} />,
    }),
    defineComponent({
      name: "AskForm",
      description: description("AskForm"),
      props: AskFormPropsSchema,
      component: ({ props }) => <AskForm fields={props.fields} {...(props.title === undefined ? {} : { title: props.title })} />,
    }),
    defineComponent({
      name: "FollowUps",
      description: description("FollowUps"),
      props: FollowUpsPropsSchema,
      component: ({ props }) => <FollowUps suggestions={props.suggestions} />,
    }),
  ],
});
