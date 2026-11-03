# 11: The agent remembers preferences across sessions; users can inspect, correct and forget them

**What to build:** Stable preferences (area, earliest acceptable time, favourite technician, and similar) are stored as facts. Each fact has a source (explicit or inferred), a status (active, pending confirmation, superseded or forgotten), evidence and validity times. The agent asks before saving a new preference it noticed. Inferred facts aren't used until the user confirms them. A correction supersedes the old fact. Forgetting writes a tombstone that also blocks re-inference from old history. Users can manage memory in chat ("what do you remember about me?", "forget my technician") and in a Memory panel in the web app. When the agent uses a remembered fact it says so.

**Blocked by:** 04

**Status:** ready-for-agent

- [x] Eval "memory across sessions": the area saved in session 1 is used, and said aloud, in session 2 without asking
- [x] Eval "memory correction": after a correction only the new value is used; the old one is superseded, not edited in place
- [x] Eval "forget then new session": the forgotten fact is never used again or re-inferred
- [x] Eval "inferred unconfirmed vs confirmed": an inferred fact isn't used until it is confirmed, and is used afterwards
- [x] Facts written from tool output are rejected (covers the injection in ticket 09)
- [x] The Memory panel lists facts with explicit/inferred badges and has Correct and Forget actions
