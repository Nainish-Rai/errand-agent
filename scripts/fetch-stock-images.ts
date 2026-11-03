// One-off: builds the app's photo assets (apps/web/features/images/assets/) from pinned sources.
//
//   pnpm images:fetch
//
// Run it only to change the photo set; the files it writes are committed, the web app bundles them,
// and nothing fetches a photo at runtime. Each photo's alt text, author and licence live with the
// registry (apps/web/features/images/registry.ts), which is the only place the UI resolves a photo.
//
// Two sources, both Unsplash photos under the Unsplash License:
//   - the design system's own set (design-system/design-system-v3.html, Images and Credits): its
//     inlined JPEGs, cropped and re-encoded here with ffmpeg and cwebp (both must be on PATH);
//   - the earlier work-photo set, cropped, resized and encoded to WebP by Unsplash's CDN.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type Ratio = "1x1" | "4x3" | "16x9";

const SIZES: Readonly<Record<Ratio, readonly [number, number]>> = {
  "1x1": [160, 160],
  "4x3": [400, 300],
  "16x9": [640, 360],
};

/** A photo inlined in design-system-v3.html: its key there, and the crops the app uses. */
interface DesignSystemPhoto {
  readonly key: string;
  readonly v3: string;
  readonly ratios: readonly Ratio[];
}

/** A photo on Unsplash's CDN (images.unsplash.com/<cdnId>). */
interface CdnPhoto {
  readonly key: string;
  readonly cdnId: string;
  readonly ratios: readonly Ratio[];
}

const SERVICE: readonly Ratio[] = ["1x1", "4x3", "16x9"];

const DESIGN_SYSTEM_PHOTOS: readonly DesignSystemPhoto[] = [
  { key: "plumbing", v3: "plumbing", ratios: SERVICE },
  { key: "ac-servicing", v3: "ac", ratios: SERVICE },
  { key: "electrician", v3: "electrician", ratios: SERVICE },
  { key: "deep-cleaning", v3: "cleaning", ratios: SERVICE },
  { key: "pest-control", v3: "pest", ratios: SERVICE },
  { key: "carpentry", v3: "carpentry", ratios: SERVICE },
  { key: "appliance-repair", v3: "appliance", ratios: SERVICE },
  { key: "ac-gas-refill", v3: "acgas", ratios: SERVICE },
  { key: "ac-deep-clean", v3: "acclean", ratios: SERVICE },
  { key: "ac-repair", v3: "acrepair", ratios: SERVICE },
  { key: "plumbing-job", v3: "job", ratios: SERVICE },
  { key: "plumber-kit", v3: "shiva", ratios: ["1x1"] },
  { key: "plumber-tool-bag", v3: "aqua", ratios: ["1x1"] },
  { key: "plumber-at-work", v3: "ravi", ratios: ["1x1"] },
];

const WORK: readonly Ratio[] = ["1x1", "4x3"];

const CDN_PHOTOS: readonly CdnPhoto[] = [
  { key: "work-ac-1", cdnId: "photo-1568634697393-0165d25e7acb", ratios: WORK },
  { key: "work-ac-2", cdnId: "photo-1780445392698-646b69b12dd5", ratios: WORK },
  { key: "work-ac-3", cdnId: "photo-1550998251-1e18917c975c", ratios: WORK },
  { key: "work-ac-4", cdnId: "photo-1575806980027-9e8310a6e4ab", ratios: WORK },
  { key: "work-plumbing-1", cdnId: "photo-1503789146722-cf137a3c0fea", ratios: WORK },
  { key: "work-plumbing-2", cdnId: "photo-1503788943072-cd614c3056cf", ratios: WORK },
  { key: "work-plumbing-3", cdnId: "photo-1538474705339-e87de81450e8", ratios: WORK },
  { key: "work-electrical-1", cdnId: "photo-1544724569-5f546fd6f2b5", ratios: WORK },
  { key: "work-electrical-2", cdnId: "photo-1566417110090-6b15a06ec800", ratios: WORK },
  { key: "work-electrical-3", cdnId: "photo-1576446468729-7674e99608f5", ratios: WORK },
  { key: "work-carpentry-1", cdnId: "photo-1685320198649-781e83a61de4", ratios: WORK },
  { key: "work-carpentry-2", cdnId: "photo-1444208393177-b2a88904ed8d", ratios: WORK },
  { key: "work-carpentry-3", cdnId: "photo-1426927308491-6380b6a9936f", ratios: WORK },
  { key: "work-carpentry-4", cdnId: "photo-1631561381316-570336556ab4", ratios: WORK },
  { key: "work-cleaning-1", cdnId: "photo-1550963295-019d8a8a61c5", ratios: WORK },
  { key: "work-cleaning-2", cdnId: "photo-1610389473058-fd68ad1d8bac", ratios: WORK },
  { key: "work-cleaning-3", cdnId: "photo-1729516631658-8bbb27fd1d12", ratios: WORK },
  { key: "work-cleaning-4", cdnId: "photo-1616810023967-777c6cc93060", ratios: WORK },
];

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "apps/web/features/images/assets");
// Every file stays under 32 KB, as v3 asks; busy work photos need the CDN's lower setting.
const CDN_QUALITY = 40;
const LOCAL_QUALITY = 72;

const fileOf = (key: string, ratio: Ratio) => path.join(ASSETS, `${key}-${ratio}.webp`);

async function downloadCrop(photo: CdnPhoto, ratio: Ratio): Promise<number> {
  const [width, height] = SIZES[ratio];
  const response = await fetch(`https://images.unsplash.com/${photo.cdnId}?w=${width}&h=${height}&fit=crop&q=${CDN_QUALITY}&fm=webp`);
  if (!response.ok || response.headers.get("content-type") !== "image/webp") {
    throw new Error(`${photo.key}: ${response.status} ${response.headers.get("content-type")}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(fileOf(photo.key, ratio), bytes);
  return bytes.length;
}

/** The design system's inlined JPEGs by their key there. */
function designSystemSources(): ReadonlyMap<string, Buffer> {
  const html = readFileSync(path.join(ROOT, "design-system/design-system-v3.html"), "utf8");
  const sources = new Map<string, Buffer>();
  for (const [, key, base64] of html.matchAll(/^"(\w+)": "data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/gm)) {
    if (key !== undefined && base64 !== undefined) sources.set(key, Buffer.from(base64, "base64"));
  }
  return sources;
}

/**
 * The largest centred crop of `ratio`, no bigger than the source (these sources are small, so a
 * crop is never upscaled past them), as WebP.
 */
function encodeCrop(source: string, photo: DesignSystemPhoto, ratio: Ratio, work: string): number {
  const [width, height] = SIZES[ratio];
  const png = path.join(work, `${photo.key}-${ratio}.png`);
  const crop = `crop='min(iw,ih*${width}/${height})':'min(ih,iw*${height}/${width})',scale='min(${width},iw)':-2`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-vf", crop, png]);
  execFileSync("cwebp", ["-quiet", "-q", String(LOCAL_QUALITY), "-m", "6", "-metadata", "none", png, "-o", fileOf(photo.key, ratio)]);
  return statSync(fileOf(photo.key, ratio)).size;
}

await mkdir(ASSETS, { recursive: true });
const sources = designSystemSources();
const work = mkdtempSync(path.join(tmpdir(), "errand-images-"));
try {
  for (const photo of DESIGN_SYSTEM_PHOTOS) {
    const bytes = sources.get(photo.v3);
    if (bytes === undefined) throw new Error(`${photo.key}: design-system-v3.html has no photo "${photo.v3}"`);
    const source = path.join(work, `${photo.key}.jpg`);
    writeFileSync(source, bytes);
    for (const ratio of photo.ratios) console.log(`${photo.key}-${ratio}.webp ${encodeCrop(source, photo, ratio, work)} bytes`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const photo of CDN_PHOTOS) {
  for (const ratio of photo.ratios) console.log(`${photo.key}-${ratio}.webp ${await downloadCrop(photo, ratio)} bytes`);
}
console.log(`Wrote ${DESIGN_SYSTEM_PHOTOS.length + CDN_PHOTOS.length} photos to ${path.relative(ROOT, ASSETS)}`);
