import { localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import { CALLER_AUTH } from "../lib/memory-owner";
import { ownSessionsOnly } from "../lib/session-access";

// The chat API. Its auth walk is the app API's too, so the chat and the Memory panel see the same
// person, and a caller reaches only their own sessions (another person's session answers 404).
// The trailing localDev() accepts nothing the guarded walk refused (a refusal throws, and the walk
// already tried it); it is listed so eve still knows the channel admits the local developer to
// GET /eve/v1/info.
export default eveChannel({
  auth: [ownSessionsOnly(CALLER_AUTH), localDev()],
  cors: true,
  uploadPolicy: "disabled",
});
