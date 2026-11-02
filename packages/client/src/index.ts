export { ApiClient, ApiRequestError, type ApiClientOptions } from "./api-client";
export {
  ChatClient,
  replyIn,
  toolCallsIn,
  type ChatClientOptions,
  type ChatTurn,
  type ToolCallView,
} from "./chat-session";
export type { ClientSession, EveMessage, EveMessagePart, EveToolPart } from "eve/client";

/** Where the backend listens in local development. */
export const DEFAULT_BACKEND_URL = "http://localhost:3100";
