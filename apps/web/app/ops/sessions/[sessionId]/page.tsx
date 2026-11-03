import { OperatorConsole } from "@/features/ops/operator-console";

export default async function Page({ params }: { readonly params: Promise<{ readonly sessionId: string }> }) {
  const { sessionId } = await params;
  return <OperatorConsole sessionId={decodeURIComponent(sessionId)} />;
}
