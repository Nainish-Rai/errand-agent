import type { Metadata } from "next";

import { DesignGallery } from "@/features/design-gallery/design-gallery";

export const metadata: Metadata = { title: "Design system · Errand agent" };

export default function DesignPage() {
  return <DesignGallery />;
}
