# 23: Home, memory and the operator console in Lime, with layout motion

**What to build:** Home, the memory sheet and `/ops` match v3. Home has a greeting, the composer, follow-ups, service tiles, upcoming bookings and alerts; it has no stat-card row and no icon tiles. Memory has inspect, correct and forget, and the "Memory updated · View" line in chat. The operator console is the only place the trace rail appears, with no glow. Every layout change animates with Lime's tokens: widgets entering and leaving, list rows added and removed, panels collapsing, sheets and dialogs, count changes.

**Blocked by:** 20

**Status:** ready-for-agent

- [ ] Home, memory and ops match v3 in light and dark; screenshots are attached
- [ ] The person's chat never shows the trace rail; the operator-only suites still pass
- [ ] List and widget changes animate with Lime's tokens, with no layout jump; this is proven by a mid-animation screenshot
- [ ] Under reduced motion layout changes are instant, and focus and feedback are kept
