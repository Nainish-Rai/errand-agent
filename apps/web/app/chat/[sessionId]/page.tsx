import { chatEntryOf } from "@/features/chat/chat-entry";
import { ChatScreen } from "@/features/chat/chat-screen";

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sessionId } = await params;
  return <ChatScreen sessionId={decodeURIComponent(sessionId)} entry={chatEntryOf(await searchParams)} />;
}
