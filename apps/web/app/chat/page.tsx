import { chatEntryOf } from "@/features/chat/chat-entry";
import { NewChatScreen } from "@/features/chat/chat-screen";

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NewChatScreen entry={chatEntryOf(await searchParams)} />;
}
