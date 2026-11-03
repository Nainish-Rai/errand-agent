// One-off: downloads the mock providers' service photos from a pinned list and writes CREDITS.md.
//
//   pnpm images:fetch
//
// Run it only to change the photo set; the files it writes are committed, and nothing fetches
// photos at runtime. Every photo is a free Unsplash photo (Unsplash License) of a service scene:
// tools, AC units, wiring, pipes, cleaning kit. No people: pairing a real person's face with
// made-up reviews wouldn't be fair to them. Unsplash's CDN crops, resizes and encodes WebP for us.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface PinnedPhoto {
  /** The file under src/adapters/world/assets/, `<service>-<n>.webp`. */
  readonly file: string;
  /** The photo's page on Unsplash. */
  readonly page: string;
  /** The CDN id on images.unsplash.com. */
  readonly cdnId: string;
  readonly photographer: string;
  readonly alt: string;
}

const PHOTOS: readonly PinnedPhoto[] = [
  { file: "ac_servicing-1.webp", page: "https://unsplash.com/photos/four-outdoor-ac-unit-JUAVCUMY008", cdnId: "photo-1568634697393-0165d25e7acb", photographer: "Ashkan Forouzani", alt: "Four split AC units on a patterned wall" },
  { file: "ac_servicing-2.webp", page: "https://unsplash.com/photos/white-outdoor-air-conditioning-unit-on-a-building-wall-ocFQ9L4w0Tk", cdnId: "photo-1780445392698-646b69b12dd5", photographer: "Sergio Martins", alt: "A white outdoor AC unit on a building wall" },
  { file: "ac_servicing-3.webp", page: "https://unsplash.com/photos/white-air-condenser-unit-JBw9IlbHhVY", cdnId: "photo-1550998251-1e18917c975c", photographer: "Vladislav Nikonov", alt: "A white AC condenser unit" },
  { file: "ac_servicing-4.webp", page: "https://unsplash.com/photos/ac-units-mounted-on-wall-outside-building-_MoKCEyU4YE", cdnId: "photo-1575806980027-9e8310a6e4ab", photographer: "Danny Feng", alt: "AC units mounted on an outside wall" },
  { file: "plumber-1.webp", page: "https://unsplash.com/photos/a-close-up-of-a-metal-sink-drain-DqC8-L5oNlo", cdnId: "photo-1654440122140-f1fc995ddb34", photographer: "Daniel Dan", alt: "A metal sink drain up close" },
  { file: "plumber-2.webp", page: "https://unsplash.com/photos/gray-adjustable-wrench-and-gray-pipe-wrench-4mAcustUNPs", cdnId: "photo-1503789146722-cf137a3c0fea", photographer: "Matt Artz", alt: "An adjustable wrench and a pipe wrench" },
  { file: "plumber-3.webp", page: "https://unsplash.com/photos/two-black-adjustable-pipe-wrenches-dod-BrjbRhY", cdnId: "photo-1503788943072-cd614c3056cf", photographer: "Matt Artz", alt: "Two adjustable pipe wrenches" },
  { file: "plumber-4.webp", page: "https://unsplash.com/photos/grayscale-photography-of-metal-pipes-scUBcasSvbE", cdnId: "photo-1538474705339-e87de81450e8", photographer: "Samuel Sianipar", alt: "Metal pipes in grayscale" },
  { file: "electrician-1.webp", page: "https://unsplash.com/photos/electrical-switch-box-with-circuit-breakers-kK7uPfb2YWU", cdnId: "photo-1544724569-5f546fd6f2b5", photographer: "Markus Spiske", alt: "A switch box with circuit breakers and wiring" },
  { file: "electrician-2.webp", page: "https://unsplash.com/photos/gray-power-switch-box-maXnRLszYY0", cdnId: "photo-1566417110090-6b15a06ec800", photographer: "Troy Bridges", alt: "A breaker in an electrical panel" },
  { file: "electrician-3.webp", page: "https://unsplash.com/photos/yellow-blue-and-black-coated-wires-iOLHAIaxpDA", cdnId: "photo-1601462904263-f2fa0c851cb9", photographer: "Frames For Your Heart", alt: "Yellow, blue and black coated wires" },
  { file: "electrician-4.webp", page: "https://unsplash.com/photos/white-circuit-breakers-ufo5IiRdqjc", cdnId: "photo-1576446468729-7674e99608f5", photographer: "Mark Kats", alt: "A row of white circuit breakers" },
  { file: "carpenter-1.webp", page: "https://unsplash.com/photos/a-workbench-with-tools-hanging-on-the-wall-NQBZ_qzqPyQ", cdnId: "photo-1685320198649-781e83a61de4", photographer: "Sparsh Paliwal", alt: "A workbench with tools hanging on the wall" },
  { file: "carpenter-2.webp", page: "https://unsplash.com/photos/brown-wooden-workbench-mNWsZDYUCFs", cdnId: "photo-1444208393177-b2a88904ed8d", photographer: "s w", alt: "A wooden workbench" },
  { file: "carpenter-3.webp", page: "https://unsplash.com/photos/assorted-handheld-tools-in-tool-rack-t5YUoHW6zRo", cdnId: "photo-1426927308491-6380b6a9936f", photographer: "Barn Images", alt: "Hand tools in a tool rack" },
  { file: "carpenter-4.webp", page: "https://unsplash.com/photos/a-group-of-woodworking-tools-sitting-on-top-of-a-table-aSglAbeMXbA", cdnId: "photo-1631561381316-570336556ab4", photographer: "Lucas Santos", alt: "Woodworking tools on a table" },
  { file: "cleaner-1.webp", page: "https://unsplash.com/photos/clear-spray-bottle-9gzU1mtTzWM", cdnId: "photo-1550963295-019d8a8a61c5", photographer: "Crystal Chabot", alt: "A clear spray bottle" },
  { file: "cleaner-2.webp", page: "https://unsplash.com/photos/blue-and-black-spray-bottle-OzRAelXHYHo", cdnId: "photo-1610389473058-fd68ad1d8bac", photographer: "Kaffeebart", alt: "A blue and black spray bottle" },
  { file: "cleaner-3.webp", page: "https://unsplash.com/photos/a-broom-and-broom-duster-sitting-on-the-ground-in-front-of-a-blue-door-LrcKM3iqA0E", cdnId: "photo-1729516631658-8bbb27fd1d12", photographer: "Van Tien Le", alt: "A broom and a duster by a blue door" },
  { file: "cleaner-4.webp", page: "https://unsplash.com/photos/brown-and-black-broom-stick-UYpEsMsErVA", cdnId: "photo-1616810023967-777c6cc93060", photographer: "shuai wang", alt: "A broom" },
];

const ASSETS = path.resolve(import.meta.dirname, "../src/adapters/world/assets");
const SIZE = "w=640&h=440&fit=crop&q=60&fm=webp";

async function download(photo: PinnedPhoto): Promise<number> {
  const response = await fetch(`https://images.unsplash.com/${photo.cdnId}?${SIZE}`);
  if (!response.ok || response.headers.get("content-type") !== "image/webp") {
    throw new Error(`${photo.file}: ${response.status} ${response.headers.get("content-type")}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path.join(ASSETS, photo.file), bytes);
  return bytes.length;
}

function credits(): string {
  const rows = PHOTOS.map((photo) => `| ${photo.file} | ${photo.alt} | ${photo.photographer} | [Unsplash](${photo.page}) | Unsplash License |`);
  return [
    "# Provider photo credits",
    "",
    "Written by `scripts/fetch-stock-images.ts`; don't edit by hand. Every photo is from Unsplash under the",
    "[Unsplash License](https://unsplash.com/license) (free to use, no attribution required; credited anyway).",
    "They show service scenes, never people. Resized to 640×440 WebP by Unsplash's CDN.",
    "",
    "| File | Shows | Photographer | Source | Licence |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

await mkdir(ASSETS, { recursive: true });
for (const photo of PHOTOS) console.log(`${photo.file} ${await download(photo)} bytes`);
await writeFile(path.join(ASSETS, "CREDITS.md"), credits());
await writeFile(
  path.join(ASSETS, "photos.json"),
  `${JSON.stringify(PHOTOS.map(({ file, alt }) => ({ file, alt })), null, 2)}\n`,
);
console.log(`Wrote ${PHOTOS.length} photos, CREDITS.md and photos.json to ${path.relative(process.cwd(), ASSETS)}`);
