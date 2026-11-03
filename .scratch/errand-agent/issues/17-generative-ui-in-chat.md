# 17: Generative UI in chat with OpenUI: generated UI may ask and show, only fixed UI may commit

**What to build:** Inside the assistant-ui chat, the agent can render model-generated UI through OpenUI, using a small custom component library in the dark theme. These are the generated surfaces:
- A missing-details form that shows only the empty fields, prefilled from memory
- **Provider choice cards** in the style of OpenUI's landing-page "Cards" demo: one card per provider (a row of up to 3, a carousel beyond that) with a service photo, a highlight tag ("Same-day", "Your favourite", "Gas refill included"), name, rating, price, earliest slot, the model's one-line reason, and **Choose** and **Details** buttons. The same choice cards serve any pick-one question
- **Charts** where they help a decision: price across options (4 or more), free slots per day this week (click a day to pick it), and spend and bookings over time when asked
- Provider details with a photo gallery of past work
- A review-insight card from the review-reader's output
- A slot picker after a slot is taken or a reschedule conflicts
- A pick-one list when "my AC servicing" matches more than one booking
- A card for confirming or dismissing inferred preferences
- Suggested next-step chips

Generated components are data-bound: they reference provider, slot or booking IDs, and price, rating, slot time and status are filled in from the read-only API. The component library contains no approve, confirm or pay component. The approval card, booking receipt, alerts and memory actions stay fixed components. An answer from an *ask* component comes back to the agent as an ordinary user turn and gets no special authority. If the UI fails to parse, the plain text reply is shown.

Mock images: every provider in the world has a service photo and a small gallery. They are free-licence stock photos (Unsplash or Pexels) of service scenes, not people, fetched once by a script from a pinned URL list and committed as small WebP files with a credits file. Logos and avatars are initials monograms generated in code. Nothing is fetched at runtime.

**Blocked by:** 04, 05, 18

**Status:** ready-for-agent

- [x] Spike result recorded: how OpenUI's assistant-ui tools are wired to eve's server-side tools, and how *ask* resumes the turn
- [x] Eval: a request missing the time window renders an *ask* form containing only that field; submitting it fills the errand without a typed reply
- [x] Eval: every generated payload parses against the library, and none contains an approval or commit action (global invariant)
- [x] Eval: a scripted model that writes a wrong price into a comparison card still shows the world's price, because the data is bound by ID
- [x] Eval: an *ask* answer such as "approve" creates no grant
- [x] Eval: clicking **Choose** on a card holds the slot and shows the fixed approval card; no booking happens until that card is clicked
- [x] Eval: chart values equal the world's data for the IDs or query, even when the scripted model writes other numbers
- [x] Every mock provider has a photo and gallery from local files, with no network at runtime, and each photo's licence and source are listed in the credits file
- [x] Dark-theme screenshots of the choice cards, a chart, and the fallback are attached
- [x] Eval: a malformed UI payload falls back to text and the trace records the parse error
- [x] Live mode reports the UI parse success rate for MiniMax in the eval table
- [x] The OpenUI instructions count toward the context budget
