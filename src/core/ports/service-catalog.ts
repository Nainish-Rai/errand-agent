import type { ServiceKind } from "./provider-world";

/** What the provider world covers: the services and Bengaluru areas a search can name. */
export interface ServiceCatalog {
  services(): readonly ServiceKind[];
  areas(): readonly string[];
  /** The catalog's service for a name or alias ("plumbing" → plumber), or undefined. */
  resolveService(text: string): ServiceKind | undefined;
  /** The catalog's own spelling of an area ("hsr" → "HSR Layout"), or undefined when it isn't covered. */
  resolveArea(text: string): string | undefined;
}
