// Layer 3: the library bridge. shadcn variable names, read by the eve chat template, assistant-ui and
// agents-ui. The mapping is the same in both themes; it follows the roles, which change per theme.
import type { ColorPrimitive, radius } from "./primitives";
import type { SemanticRole } from "./roles";

export type BridgeValue =
  | { readonly kind: "role"; readonly role: SemanticRole }
  | { readonly kind: "primitive"; readonly primitive: ColorPrimitive }
  | { readonly kind: "radius"; readonly radius: keyof typeof radius };

const role = (name: SemanticRole): BridgeValue => ({ kind: "role", role: name });
const primitive = (name: ColorPrimitive): BridgeValue => ({ kind: "primitive", primitive: name });

export const bridge = {
  background: role("surface-canvas"),
  foreground: role("fg-emph"),
  card: role("surface-card"),
  "card-foreground": role("fg-emph"),
  popover: role("surface-raised"),
  "popover-foreground": role("fg-emph"),
  primary: role("fg-emph"),
  "primary-foreground": role("surface-canvas"),
  secondary: role("surface-raised"),
  "secondary-foreground": role("fg-emph"),
  muted: role("surface-raised"),
  "muted-foreground": role("fg-meta"),
  accent: role("surface-raised"),
  "accent-foreground": role("fg-emph"),
  destructive: role("err"),
  border: role("edge"),
  input: role("edge"),
  ring: role("interactive"),
  radius: { kind: "radius", radius: "radius-3" },
  "chart-1": primitive("cat-1"),
  "chart-2": primitive("cat-2"),
  "chart-3": primitive("cat-3"),
  "chart-4": primitive("cat-4"),
  "chart-5": primitive("cat-5"),
} as const satisfies Record<string, BridgeValue>;

export type BridgeName = keyof typeof bridge;
