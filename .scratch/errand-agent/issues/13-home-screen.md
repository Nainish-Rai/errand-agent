# 13: Home screen like the reference: hero, errand composer and live widgets

**What to build:** A dense home screen modelled on the reference screenshot, following the mock in `mockups/home.html`. It has dark and light themes; the light theme turns the hero into a daytime skyline.
- **Hero:** a banner with the headline "What errand should I handle?"
- **Composer:** a card with tabs (New errand / Running N) and chips for area, budget, time of day and model. Sending from the composer opens the chat.
- **Suggestions:** chips for common errands.
- **Widget grid**, fed by the backend's home summary:
  - **Working now:** errands in progress and their current step
  - **Waiting on you:** pending approvals and inferred facts to confirm; each opens the right chat or card
  - **Upcoming bookings:** each booking with its status
  - **Alerts:** provider cancellations and recovered failures
  - **Bookings · 14 days:** an activity chart
  - **Memory:** preferences, with inferred ones shown dashed
- **Top bar:** a home switcher, search, a light/dark toggle and a notification bell. The bell is wired up in ticket 14.

The layout is responsive and drops to one column on phone widths. A rounder, more consumer-style alternative is kept in `mockups/home-rounded-alt.html`.

**Blocked by:** 05, 11, 18

**Status:** ready-for-agent

- [x] Starting an errand from the composer, with chips prefilled, opens a chat with those details already in the errand state, so the agent doesn't ask for them
- [x] Each widget shows live data from the local system, and the empty states are designed
- [x] Clicking a pending approval in Waiting on you opens that chat at the card
- [x] The theme follows the system setting by default, the toggle switches it, and the choice persists
- [x] Both themes meet WCAG AA text contrast
- [x] Dark and light screenshots at desktop and mobile widths are attached to the ticket (`docs/evidence/13/`)
