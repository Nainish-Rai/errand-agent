import { Suspense } from "react";

import { chatEntryOf } from "@/features/chat/chat-entry";
import { ChatLoading, NewChatScreen } from "@/features/chat/chat-screen";

type PageProps = { readonly searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The URL is read under its own Suspense boundary, so a navigation shows the chat's loading frame at once. */
async function NewChatFromUrl({ searchParams }: PageProps) {
  return <NewChatScreen entry={chatEntryOf(await searchParams)} />;
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ChatLoading />}>
      <NewChatFromUrl {...props} />
    </Suspense>
  );
}
