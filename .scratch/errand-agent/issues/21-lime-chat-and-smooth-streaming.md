# 21: Chat in Lime: smooth answer streaming, progress steps, approval and receipt

**What to build:** The chat looks and moves like the v3 Message, Chat input, Streaming answers, Approval, "After approval: checking with provider" and Receipt sections. Assistant answers stream as v3 specifies:
- a frame-paced reveal whose rate rises with the backlog, so it trails the model by at most `--dur-stream-lag` and never jumps when the stream ends;
- each new word blurs in over `--dur-stream-word`, earlier words never move, and there is no caret or shimmer;
- the spans unwrap when the answer ends.

Use Streamdown's animation and assistant-ui's smoothing where they fit; build only what is missing. Agent progress shows as ToolCall rows with a Status. The approval card becomes the Lime ApprovalRequest, with "Approve ₹899" as the one glowing action and the stale state when the price, slot or provider changes. The receipt becomes the ActionReceipt with Reschedule and Cancel booking, and no Undo. Every state change animates with Lime's tokens.

**Blocked by:** 20

**Status:** done (PR #25)

- [x] A bursty stream (uneven chunk sizes and gaps) reveals evenly: an automated test drives a fake stream and asserts the lag bound, that no already-shown word re-renders, and that nothing is left wrapped at the end
- [x] Under reduced motion, words appear with no blur or rise
- [x] Screen readers get the answer once: the message is `aria-busy` while streaming
- [x] The approval card states, the tracker steps and the receipt match v3; the approve labels stay "Approve ₹<price>", "Approve move" and "Approve free cancellation"
- [x] Each view has exactly one lime action; the existing approval, booking, reschedule and cancellation suites still pass
- [ ] A mid-stream screenshot and a mid-animation approval screenshot from a verify-errand run are attached
