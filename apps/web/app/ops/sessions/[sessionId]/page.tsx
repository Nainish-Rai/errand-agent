import { Suspense } from "react";

import { OperatorConsole, OperatorConsoleLoading } from "@/features/ops/operator-console";

type PageProps = { readonly params: Promise<{ readonly sessionId: string }> };

/** The URL is read under its own Suspense boundary, so a navigation shows the console's loading frame at once. */
async function ConsoleFromUrl({ params }: PageProps) {
  const { sessionId } = await params;
  return <OperatorConsole sessionId={decodeURIComponent(sessionId)} />;
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<OperatorConsoleLoading />}>
      <ConsoleFromUrl {...props} />
    </Suspense>
  );
}
