import { Suspense } from "react";

import { chatEntryOf } from "@/features/chat/chat-entry";
import { ChatLoading, ChatScreen } from "@/features/chat/chat-screen";

type PageProps = {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The URL is read under its own Suspense boundary, so a navigation shows the chat's loading frame at once. */
async function ChatFromUrl({ params, searchParams }: PageProps) {
  const { sessionId } = await params;
  return <ChatScreen sessionId={decodeURIComponent(sessionId)} entry={chatEntryOf(await searchParams)} />;
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatFromUrl {...props} />
    </Suspense>
  );
}
