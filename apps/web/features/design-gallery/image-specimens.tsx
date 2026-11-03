import type { ImageKey } from "@errand/contracts";
import type { ReactNode } from "react";

import { Photo, PHOTO_CREDITS, ProviderThumbnail, ServiceIcon } from "@/features/images";

// /design's Images section (v3 Images): every ratio and size, both fallbacks, and the credits for
// every photo the app ships. The failed specimens use keys the registry doesn't have, so they fetch
// nothing and show the fallback exactly as a hostile or missing key would.

function Specimen({ caption, children }: { readonly caption: string; readonly children: ReactNode }) {
  return (
    <figure className="m-0 flex flex-col items-start gap-1.5">
      {children}
      <figcaption className="text-xs text-fg-3">{caption}</figcaption>
    </figure>
  );
}

export function ImageSpecimens() {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Specimen caption="1:1, 40px, --radius-sm">
        <ProviderThumbnail imageKey="plumber-kit" name="Shiva Sanitary" />
      </Specimen>
      <Specimen caption="1:1, 56px, --radius-field">
        <ProviderThumbnail imageKey="plumber-at-work" name="Ravi Plumbing" size={56} />
      </Specimen>
      <Specimen caption="4:3, 120px tile, --radius-field">
        <Photo imageKey="carpentry" ratio="landscape" fallback={<ServiceIcon service="carpenter" />} className="w-[120px] rounded-field" />
      </Specimen>
      <Specimen caption="16:9 hero, --radius-panel">
        <Photo imageKey="ac-servicing" ratio="wide" fallback={<ServiceIcon service="ac_servicing" />} className="w-[200px] rounded-panel" />
      </Specimen>
      <Specimen caption="Failed: initials">
        <ProviderThumbnail imageKey="https://images.example.com/shiva.png" name="Shiva Sanitary" size={56} />
      </Specimen>
      <Specimen caption="Failed: line icon">
        <Photo imageKey="not-a-registered-key" ratio="landscape" fallback={<ServiceIcon service="plumber" />} className="w-[120px] rounded-field" />
      </Specimen>
    </div>
  );
}

const CREDITS = Object.entries(PHOTO_CREDITS) as [ImageKey, (typeof PHOTO_CREDITS)[ImageKey]][];

export function PhotoCredits() {
  return (
    <section aria-labelledby="photo-credits" className="mx-4 mb-6 rounded-panel border border-line bg-page p-4 text-fg">
      <h2 id="photo-credits" className="m-0 text-lg font-semibold">
        Photo credits
      </h2>
      <p className="m-0 mt-1 mb-3 text-sm text-fg-2">
        Every photo is from Unsplash under the{" "}
        <a className="underline underline-offset-4" href="https://unsplash.com/license" rel="noreferrer" target="_blank">
          Unsplash License
        </a>
        , resized and compressed, and shipped with the app: nothing is loaded from Unsplash.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="text-xs text-fg-3">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">Photo</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Shows</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Used for</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Author</th>
              <th scope="col" className="py-1.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {CREDITS.map(([key, credit]) => (
              <tr key={key} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <Photo imageKey={key} ratio="square" fallback="" className="w-10 rounded-sm" />
                </td>
                <td className="py-1.5 pr-3 text-fg-2">{credit.alt}</td>
                <td className="py-1.5 pr-3 text-fg-2">{credit.use}</td>
                <td className="py-1.5 pr-3">{credit.author}</td>
                <td className="py-1.5">
                  <a className="font-mono text-xs underline underline-offset-4" href={credit.source} rel="noreferrer" target="_blank">
                    {credit.source.replace("https://", "")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
