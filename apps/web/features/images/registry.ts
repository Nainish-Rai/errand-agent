import type { ImageKey } from "@errand/contracts";

import { PHOTO_FILES, type PhotoFiles } from "./assets";

// The closed photo registry: the only way the UI turns an image key into a picture. A key comes
// from the provider world (a provider's thumbnail, a service tile) and is untrusted; anything that
// isn't one of these keys — a URL, a data: URI, a path, a file name, a prototype name — resolves to
// nothing, and the caller draws its fallback without fetching anything. Every photo is a file the
// app bundles (assets.ts), with its alt text and credit here; the credits are shown on /design.

export interface PhotoCredit {
  /** What the photo shows, as its alt text. */
  readonly alt: string;
  /** Where the app uses it, for the credits table. */
  readonly use: string;
  readonly author: string;
  /** The photo's page on Unsplash. */
  readonly source: string;
}

const unsplash = (id: string) => `https://unsplash.com/photos/${id}`;

export const PHOTO_CREDITS = {
  plumbing: { alt: "Close-up of a steel sink drain", use: "Plumbing tile, plumber cards", author: "Daniel Dan", source: unsplash("DqC8-L5oNlo") },
  "ac-servicing": { alt: "Split AC outdoor unit on a wall bracket", use: "AC servicing tile, AC cards", author: "Andrianto Cahyono Putro", source: unsplash("ItJsBJlf5Qw") },
  electrician: { alt: "Wiring and breakers inside a distribution board", use: "Electrician tile, electrician cards", author: "Mostafa Mahmoudi", source: unsplash("47jO5Y8nsYo") },
  "deep-cleaning": { alt: "Gloved hand holding a yellow spray bottle", use: "Deep cleaning tile, cleaner cards", author: "JESHOOTS.COM", source: unsplash("__ZMnefoI3k") },
  "pest-control": { alt: "Hand-held sprayer misting", use: "Pest control (design system only)", author: "MESTO Sprayers", source: unsplash("KtU82_xkOJs") },
  carpentry: { alt: "Hammer, pliers and a tape measure on wooden planks", use: "Carpentry tile, carpenter cards", author: "Louis Hansel", source: unsplash("Rf9eElW3Qxo") },
  "appliance-repair": { alt: "Front-load washing machines in a row", use: "Appliance repair (design system only)", author: "Oli Woodman", source: unsplash("nUL_PP69IPA") },
  "ac-gas-refill": { alt: "Technician connecting a gas cylinder to an outdoor AC unit", use: "AC option: gas refill", author: "Joel Muniz", source: unsplash("L5sEqpQukJI") },
  "ac-deep-clean": { alt: "Hands lifting an AC filter grille to clean it", use: "AC option: deep clean", author: "Birmingham Airduct Cleaning Services", source: unsplash("WwzK2S0h6zU") },
  "ac-repair": { alt: "Hands working on the pipes of an AC unit", use: "AC option: repair", author: "Joel Muniz", source: unsplash("8RbiLgfqoqQ") },
  "plumbing-job": { alt: "Utility room sink and pipes after a repair", use: "Plumber cards and galleries", author: "N1CE", source: unsplash("ml1AZqsrtqg") },
  "plumber-kit": { alt: "Spanners and screwdrivers from a plumber's kit", use: "Shiva plumbing teams: cards, approval, receipt", author: "Elena Rouame", source: unsplash("9JU2CKqtw0M") },
  "plumber-tool-bag": { alt: "A plumber's tool bag and fittings on a tiled floor", use: "QuickFix plumbing teams: cards, approval, receipt", author: "Annie Spratt", source: unsplash("4kgJW92pVTk") },
  "plumber-at-work": { alt: "A plumbing technician beside a water drum", use: "Ravi plumbing teams: cards, approval, receipt", author: "Karthick Gislen", source: unsplash("m0vL_kwSpeM") },
  "work-ac-1": { alt: "Four split AC units on a patterned wall", use: "AC cards and galleries", author: "Ashkan Forouzani", source: unsplash("JUAVCUMY008") },
  "work-ac-2": { alt: "A white outdoor AC unit on a building wall", use: "AC cards and galleries", author: "Sergio Martins", source: unsplash("ocFQ9L4w0Tk") },
  "work-ac-3": { alt: "A white AC condenser unit", use: "AC cards and galleries", author: "Vladislav Nikonov", source: unsplash("JBw9IlbHhVY") },
  "work-ac-4": { alt: "AC units mounted on an outside wall", use: "AC cards and galleries", author: "Danny Feng", source: unsplash("_MoKCEyU4YE") },
  "work-plumbing-1": { alt: "An adjustable wrench and a pipe wrench", use: "Plumber cards and galleries", author: "Matt Artz", source: unsplash("4mAcustUNPs") },
  "work-plumbing-2": { alt: "Two adjustable pipe wrenches", use: "Plumber cards and galleries", author: "Matt Artz", source: unsplash("dod-BrjbRhY") },
  "work-plumbing-3": { alt: "Metal pipes in grayscale", use: "Plumber cards and galleries", author: "Samuel Sianipar", source: unsplash("scUBcasSvbE") },
  "work-electrical-1": { alt: "A switch box with circuit breakers and wiring", use: "Electrician cards and galleries", author: "Markus Spiske", source: unsplash("kK7uPfb2YWU") },
  "work-electrical-2": { alt: "A breaker in an electrical panel", use: "Electrician cards and galleries", author: "Troy Bridges", source: unsplash("maXnRLszYY0") },
  "work-electrical-3": { alt: "A row of white circuit breakers", use: "Electrician cards and galleries", author: "Mark Kats", source: unsplash("ufo5IiRdqjc") },
  "work-carpentry-1": { alt: "A workbench with tools hanging on the wall", use: "Carpenter cards and galleries", author: "Sparsh Paliwal", source: unsplash("NQBZ_qzqPyQ") },
  "work-carpentry-2": { alt: "A wooden workbench", use: "Carpenter cards and galleries", author: "s w", source: unsplash("mNWsZDYUCFs") },
  "work-carpentry-3": { alt: "Hand tools in a tool rack", use: "Carpenter cards and galleries", author: "Barn Images", source: unsplash("t5YUoHW6zRo") },
  "work-carpentry-4": { alt: "Woodworking tools on a table", use: "Carpenter cards and galleries", author: "Lucas Santos", source: unsplash("aSglAbeMXbA") },
  "work-cleaning-1": { alt: "A clear spray bottle", use: "Cleaner cards and galleries", author: "Crystal Chabot", source: unsplash("9gzU1mtTzWM") },
  "work-cleaning-2": { alt: "A blue and black spray bottle", use: "Cleaner cards and galleries", author: "Kaffeebart", source: unsplash("OzRAelXHYHo") },
  "work-cleaning-3": { alt: "A broom and a duster by a blue door", use: "Cleaner cards and galleries", author: "Van Tien Le", source: unsplash("LrcKM3iqA0E") },
  "work-cleaning-4": { alt: "A broom", use: "Cleaner cards and galleries", author: "shuai wang", source: unsplash("UYpEsMsErVA") },
} as const satisfies Record<ImageKey, PhotoCredit>;

export interface RegisteredPhoto {
  readonly key: ImageKey;
  readonly alt: string;
  readonly files: PhotoFiles;
}

/** True only for a key the app ships. Own properties only, so `__proto__` or `constructor` never match. */
export function isRegisteredKey(key: unknown): key is ImageKey {
  return typeof key === "string" && Object.hasOwn(PHOTO_FILES, key) && Object.hasOwn(PHOTO_CREDITS, key);
}

/** The bundled photo for an untrusted key, or undefined: the caller then draws its fallback. */
export function registeredPhoto(key: unknown): RegisteredPhoto | undefined {
  if (!isRegisteredKey(key)) return undefined;
  return { key, alt: PHOTO_CREDITS[key].alt, files: PHOTO_FILES[key] };
}
