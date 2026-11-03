# 24: A different job in a booked chat becomes a "New errand" card that moves to a new chat

**What to build:** Each chat holds one errand. Once it's booked, asking for a different job ("what about my mom's house in HSR", "she needs her AC repaired") used to print `No search for ac servicing in HSR Layout: not editable.` and then a paragraph telling the person to ask again in a new message. Instead, the chat shows a **New errand** card carrying what's already known: the service, the area, and the when if one was given. The card says that the current booking stays as it is. Its one primary action is **Start in a new chat**. Tapping it starts a new chat with those details saved as the new errand before the first model turn, the same way the home composer does with its chips. It then sends the person's words as that chat's first message and navigates there, so the conversation continues in the new chat without the person retyping anything.

The old chat keeps a record. The card turns into a line, "Moved to a new chat · Open", which links to the new chat and still reads that way after a reload. The new chat shows where it came from ("Started from your Indiranagar shower chat · Open").

Starting a new errand books and spends nothing, so the card needs no approval. Its fields come from the refused search's arguments and the errand view, never from free model text. A tool result can't put a URL or an action on it.

The agent's instructions change too. When the person asks for a different job and the errand is booked or otherwise not editable, the agent calls the search with the new job so the card appears. It then says one short line, for example "That's a new errand. Tap Start in a new chat and I'll pick it up there." It never asks the person to retype the request.

**Blocked by:** the light-mode chat polish PR (#24, merged). Ticket 21 (the chat restyle) is in flight: rebase onto it when it merges.

**Status:** ready-for-agent

- [x] A search refused because the errand isn't editable renders the New errand card, with service, area and when from the search, and never an outcome code
- [x] Start in a new chat creates a session, saves the draft before the first turn, sends the person's words, and navigates there; the first agent turn already sees the area, so it doesn't ask for it again
- [x] The old chat shows "Moved to a new chat · Open" after a reload, the new chat links back, and the old booking is unchanged (world state checked through the API)
- [x] Not now dismisses the card, and the person can still type in the old chat
- [x] An offline eval: in a booked errand, "she needs her AC repaired in HSR" leads to the card and not to a "start a new request" paragraph, and nothing is booked or held
- [x] A verify-errand suite drives the whole hand-off (book, ask for a new job, Start in a new chat, land in the new chat with the area set, go back, see the moved line). Its screenshots, in light and dark, are attached; the suite fails on a plant
- [ ] The card follows v3 (Lime): one lime action, layout motion with Lime's tokens, instant under reduced motion, and focus moves to the new chat's composer after the move
  (Not fully met: one lime action, Lime's tokens and the composer focus are proven in the browser; "instant under reduced motion" is in the code only, `useReducedMotion` zeroes the durations, and no browser run proved it.)
