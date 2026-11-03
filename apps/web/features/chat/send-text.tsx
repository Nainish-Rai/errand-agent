"use client";

import { createContext, useContext } from "react";

// Lets a part of a message send a message as the person, as a quick-reply chip does. The chat
// screen provides it from the same eve session the composer sends through.

type SendText = (text: string) => Promise<void>;

const SendTextContext = createContext<SendText | undefined>(undefined);

export const SendTextProvider = SendTextContext.Provider;

export function useSendText(): SendText {
  const send = useContext(SendTextContext);
  if (send === undefined) throw new Error("useSendText needs a SendTextProvider above it.");
  return send;
}
