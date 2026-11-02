import { Client, conversationOf, type ClientSession, type EveMessage, type SessionStreamEvent } from "eve/client";

export interface ChatClientOptions {
  /** Backend origin, e.g. `http://localhost:3100`. */
  readonly baseUrl: string;
}

export interface ToolCallView {
  readonly name: string;
  readonly state: string;
  readonly input: unknown;
  readonly output: unknown;
}

/** One finished turn, as any client (web, mobile, an eval, a script) can read it. */
export interface ChatTurn {
  readonly sessionId: string;
  readonly events: readonly SessionStreamEvent[];
  readonly messages: readonly EveMessage[];
  readonly toolCalls: readonly ToolCallView[];
  readonly reply: string;
}

export function toolCallsIn(messages: readonly EveMessage[]): ToolCallView[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool" ? [{ name: part.name, state: part.state, input: part.input, output: part.output }] : [],
    ),
  );
}

export function replyIn(messages: readonly EveMessage[]): string {
  const last = messages.findLast((message) => message.role === "assistant");
  return (last?.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    // Each model step is its own text part; keep them as separate paragraphs.
    .join("\n\n");
}

/** The chat surface at /eve/v1, wrapping eve's fetch-only client. No browser APIs. */
export class ChatClient {
  readonly #client: Client;

  constructor(options: ChatClientOptions) {
    this.#client = new Client({ baseUrl: options.baseUrl.replace(/\/$/, "") });
  }

  /** Creates a session without starting a turn, for a UI that binds to it before the first message. */
  async startSession(): Promise<ClientSession> {
    const { session } = await this.#client.sessions.create();
    return session;
  }

  /** Starts a session with its first message and waits for the turn to settle. */
  async sendFirstMessage(text: string, options: { readonly signal?: AbortSignal } = {}): Promise<ChatTurn> {
    const { delivery, session } = await this.#client.sessions.create({ message: text });
    const events: SessionStreamEvent[] = [];
    for await (const event of delivery.stream({ signal: options.signal })) events.push(event);
    const { messages } = conversationOf(events);
    return { sessionId: session.id, events, messages, toolCalls: toolCallsIn(messages), reply: replyIn(messages) };
  }
}
