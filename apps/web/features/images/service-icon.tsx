import type { ServiceKind } from "@errand/contracts";
import { AirVent, Hammer, ImageOff, Sparkles, Wrench, Zap, type LucideIcon } from "lucide-react";

// A service's line icon: the fallback a service tile or option shows where its photo is missing.

const ICONS: Readonly<Record<ServiceKind, LucideIcon>> = {
  plumber: Wrench,
  electrician: Zap,
  ac_servicing: AirVent,
  carpenter: Hammer,
  cleaner: Sparkles,
};

export function ServiceIcon({ service, className = "size-6" }: { readonly service: ServiceKind | undefined; readonly className?: string }) {
  const Icon = service === undefined ? ImageOff : ICONS[service];
  return <Icon aria-hidden strokeWidth={1.5} className={className} />;
}
