import type { ErrandAtWorkView } from "@errand/contracts";

import { StatusMark } from "@/components/status-mark";

/** Whose move an open errand waits on, as a status mark with its word: never the glyph alone. */
export function ErrandMark({ waitingOn }: { readonly waitingOn: ErrandAtWorkView["waitingOn"] }) {
  return waitingOn === "person" ? (
    <StatusMark kind="needs-you" label="Your move" className="w-20 flex-none" />
  ) : (
    <StatusMark kind="checking" label="Working" className="w-20 flex-none" />
  );
}
