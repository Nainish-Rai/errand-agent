import { eveChannel } from "eve/channels/eve";

import { CALLER_AUTH } from "../lib/memory-owner";

// The chat API. Its auth walk is the app API's too, so the chat and the Memory panel see the same person.
export default eveChannel({
  auth: [...CALLER_AUTH],
  cors: true,
  uploadPolicy: "disabled",
});
