// OpenUI's React renderer (@openuidev/react-lang) auto-mounts its Inspect widget in development,
// and that widget loads a script from a public CDN at runtime. The chat loads nothing from outside
// its own origin, so mark the widget as already mounted before react-lang is evaluated. This
// module must be the first import of the feature's entry (index.ts). Production builds drop the
// widget anyway.

const AUTO_MOUNT_FLAG = Symbol.for("openui.devtools.autoMount");
(globalThis as Record<symbol, unknown>)[AUTO_MOUNT_FLAG] = true;

export {};
