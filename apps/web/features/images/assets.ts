// Written by scripts/fetch-stock-images.ts (pnpm images:fetch); don't edit by hand.
// Every photo file the app ships, by image key and crop. Alt text and credits are in registry.ts.
import type { ImageKey } from "@errand/contracts";
import type { StaticImageData } from "next/image";

import plumbing_1x1 from "./assets/plumbing-1x1.webp";
import plumbing_4x3 from "./assets/plumbing-4x3.webp";
import plumbing_16x9 from "./assets/plumbing-16x9.webp";
import acServicing_1x1 from "./assets/ac-servicing-1x1.webp";
import acServicing_4x3 from "./assets/ac-servicing-4x3.webp";
import acServicing_16x9 from "./assets/ac-servicing-16x9.webp";
import electrician_1x1 from "./assets/electrician-1x1.webp";
import electrician_4x3 from "./assets/electrician-4x3.webp";
import electrician_16x9 from "./assets/electrician-16x9.webp";
import deepCleaning_1x1 from "./assets/deep-cleaning-1x1.webp";
import deepCleaning_4x3 from "./assets/deep-cleaning-4x3.webp";
import deepCleaning_16x9 from "./assets/deep-cleaning-16x9.webp";
import pestControl_1x1 from "./assets/pest-control-1x1.webp";
import pestControl_4x3 from "./assets/pest-control-4x3.webp";
import pestControl_16x9 from "./assets/pest-control-16x9.webp";
import carpentry_1x1 from "./assets/carpentry-1x1.webp";
import carpentry_4x3 from "./assets/carpentry-4x3.webp";
import carpentry_16x9 from "./assets/carpentry-16x9.webp";
import applianceRepair_1x1 from "./assets/appliance-repair-1x1.webp";
import applianceRepair_4x3 from "./assets/appliance-repair-4x3.webp";
import applianceRepair_16x9 from "./assets/appliance-repair-16x9.webp";
import acGasRefill_1x1 from "./assets/ac-gas-refill-1x1.webp";
import acGasRefill_4x3 from "./assets/ac-gas-refill-4x3.webp";
import acGasRefill_16x9 from "./assets/ac-gas-refill-16x9.webp";
import acDeepClean_1x1 from "./assets/ac-deep-clean-1x1.webp";
import acDeepClean_4x3 from "./assets/ac-deep-clean-4x3.webp";
import acDeepClean_16x9 from "./assets/ac-deep-clean-16x9.webp";
import acRepair_1x1 from "./assets/ac-repair-1x1.webp";
import acRepair_4x3 from "./assets/ac-repair-4x3.webp";
import acRepair_16x9 from "./assets/ac-repair-16x9.webp";
import plumbingJob_1x1 from "./assets/plumbing-job-1x1.webp";
import plumbingJob_4x3 from "./assets/plumbing-job-4x3.webp";
import plumbingJob_16x9 from "./assets/plumbing-job-16x9.webp";
import plumberKit_1x1 from "./assets/plumber-kit-1x1.webp";
import plumberToolBag_1x1 from "./assets/plumber-tool-bag-1x1.webp";
import plumberAtWork_1x1 from "./assets/plumber-at-work-1x1.webp";
import workAc1_1x1 from "./assets/work-ac-1-1x1.webp";
import workAc1_4x3 from "./assets/work-ac-1-4x3.webp";
import workAc2_1x1 from "./assets/work-ac-2-1x1.webp";
import workAc2_4x3 from "./assets/work-ac-2-4x3.webp";
import workAc3_1x1 from "./assets/work-ac-3-1x1.webp";
import workAc3_4x3 from "./assets/work-ac-3-4x3.webp";
import workAc4_1x1 from "./assets/work-ac-4-1x1.webp";
import workAc4_4x3 from "./assets/work-ac-4-4x3.webp";
import workPlumbing1_1x1 from "./assets/work-plumbing-1-1x1.webp";
import workPlumbing1_4x3 from "./assets/work-plumbing-1-4x3.webp";
import workPlumbing2_1x1 from "./assets/work-plumbing-2-1x1.webp";
import workPlumbing2_4x3 from "./assets/work-plumbing-2-4x3.webp";
import workPlumbing3_1x1 from "./assets/work-plumbing-3-1x1.webp";
import workPlumbing3_4x3 from "./assets/work-plumbing-3-4x3.webp";
import workElectrical1_1x1 from "./assets/work-electrical-1-1x1.webp";
import workElectrical1_4x3 from "./assets/work-electrical-1-4x3.webp";
import workElectrical2_1x1 from "./assets/work-electrical-2-1x1.webp";
import workElectrical2_4x3 from "./assets/work-electrical-2-4x3.webp";
import workElectrical3_1x1 from "./assets/work-electrical-3-1x1.webp";
import workElectrical3_4x3 from "./assets/work-electrical-3-4x3.webp";
import workCarpentry1_1x1 from "./assets/work-carpentry-1-1x1.webp";
import workCarpentry1_4x3 from "./assets/work-carpentry-1-4x3.webp";
import workCarpentry2_1x1 from "./assets/work-carpentry-2-1x1.webp";
import workCarpentry2_4x3 from "./assets/work-carpentry-2-4x3.webp";
import workCarpentry3_1x1 from "./assets/work-carpentry-3-1x1.webp";
import workCarpentry3_4x3 from "./assets/work-carpentry-3-4x3.webp";
import workCarpentry4_1x1 from "./assets/work-carpentry-4-1x1.webp";
import workCarpentry4_4x3 from "./assets/work-carpentry-4-4x3.webp";
import workCleaning1_1x1 from "./assets/work-cleaning-1-1x1.webp";
import workCleaning1_4x3 from "./assets/work-cleaning-1-4x3.webp";
import workCleaning2_1x1 from "./assets/work-cleaning-2-1x1.webp";
import workCleaning2_4x3 from "./assets/work-cleaning-2-4x3.webp";
import workCleaning3_1x1 from "./assets/work-cleaning-3-1x1.webp";
import workCleaning3_4x3 from "./assets/work-cleaning-3-4x3.webp";
import workCleaning4_1x1 from "./assets/work-cleaning-4-1x1.webp";
import workCleaning4_4x3 from "./assets/work-cleaning-4-4x3.webp";

export interface PhotoFiles {
  readonly square?: StaticImageData;
  readonly landscape?: StaticImageData;
  readonly wide?: StaticImageData;
}

export const PHOTO_FILES = {
  "plumbing": { square: plumbing_1x1, landscape: plumbing_4x3, wide: plumbing_16x9 },
  "ac-servicing": { square: acServicing_1x1, landscape: acServicing_4x3, wide: acServicing_16x9 },
  "electrician": { square: electrician_1x1, landscape: electrician_4x3, wide: electrician_16x9 },
  "deep-cleaning": { square: deepCleaning_1x1, landscape: deepCleaning_4x3, wide: deepCleaning_16x9 },
  "pest-control": { square: pestControl_1x1, landscape: pestControl_4x3, wide: pestControl_16x9 },
  "carpentry": { square: carpentry_1x1, landscape: carpentry_4x3, wide: carpentry_16x9 },
  "appliance-repair": { square: applianceRepair_1x1, landscape: applianceRepair_4x3, wide: applianceRepair_16x9 },
  "ac-gas-refill": { square: acGasRefill_1x1, landscape: acGasRefill_4x3, wide: acGasRefill_16x9 },
  "ac-deep-clean": { square: acDeepClean_1x1, landscape: acDeepClean_4x3, wide: acDeepClean_16x9 },
  "ac-repair": { square: acRepair_1x1, landscape: acRepair_4x3, wide: acRepair_16x9 },
  "plumbing-job": { square: plumbingJob_1x1, landscape: plumbingJob_4x3, wide: plumbingJob_16x9 },
  "plumber-kit": { square: plumberKit_1x1 },
  "plumber-tool-bag": { square: plumberToolBag_1x1 },
  "plumber-at-work": { square: plumberAtWork_1x1 },
  "work-ac-1": { square: workAc1_1x1, landscape: workAc1_4x3 },
  "work-ac-2": { square: workAc2_1x1, landscape: workAc2_4x3 },
  "work-ac-3": { square: workAc3_1x1, landscape: workAc3_4x3 },
  "work-ac-4": { square: workAc4_1x1, landscape: workAc4_4x3 },
  "work-plumbing-1": { square: workPlumbing1_1x1, landscape: workPlumbing1_4x3 },
  "work-plumbing-2": { square: workPlumbing2_1x1, landscape: workPlumbing2_4x3 },
  "work-plumbing-3": { square: workPlumbing3_1x1, landscape: workPlumbing3_4x3 },
  "work-electrical-1": { square: workElectrical1_1x1, landscape: workElectrical1_4x3 },
  "work-electrical-2": { square: workElectrical2_1x1, landscape: workElectrical2_4x3 },
  "work-electrical-3": { square: workElectrical3_1x1, landscape: workElectrical3_4x3 },
  "work-carpentry-1": { square: workCarpentry1_1x1, landscape: workCarpentry1_4x3 },
  "work-carpentry-2": { square: workCarpentry2_1x1, landscape: workCarpentry2_4x3 },
  "work-carpentry-3": { square: workCarpentry3_1x1, landscape: workCarpentry3_4x3 },
  "work-carpentry-4": { square: workCarpentry4_1x1, landscape: workCarpentry4_4x3 },
  "work-cleaning-1": { square: workCleaning1_1x1, landscape: workCleaning1_4x3 },
  "work-cleaning-2": { square: workCleaning2_1x1, landscape: workCleaning2_4x3 },
  "work-cleaning-3": { square: workCleaning3_1x1, landscape: workCleaning3_4x3 },
  "work-cleaning-4": { square: workCleaning4_1x1, landscape: workCleaning4_4x3 },
} as const satisfies Record<ImageKey, PhotoFiles>;
