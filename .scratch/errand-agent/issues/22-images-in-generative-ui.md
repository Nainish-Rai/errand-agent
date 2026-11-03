# 22: Images in generative UI: provider photos, service tiles and image choice cards

**What to build:** Generative UI shows images where they help the person choose, as in v3's Images section:
- provider rows and cards carry a provider or job photo;
- the home "Book a service" tiles and the suggestions carry service photos;
- choice cards such as "Which AC service?" (Gas refill, Deep clean, Repair) carry an image per option;
- the approval card and the receipt show a small provider thumbnail.

Images are local, licensed assets shipped with the app (the v3 Unsplash set, credited). Tool output never supplies an image URL. The mock world maps a provider or service id to an asset key, and the UI resolves only known keys. A missing or failed image falls back to initials or a line icon on `--surface`. Images load behind a placeholder of the same size and fade in with `--dur-base`.

**Blocked by:** 20

**Status:** ready-for-agent

- [x] Image assets and their credits live in the app; the credits are visible on a page
- [x] A tool result containing an image URL, or an unknown asset key, renders the fallback and never fetches anything: an eval or test proves it
- [x] Every image has alt text, has a fixed aspect ratio (1:1 avatar, 4:3 option, 16:9 hero) and causes no layout shift on load
- [x] Provider choice, service choice and home tiles show the images in a verify-errand run, and screenshots are attached
