import type { ServiceCatalog } from "../../core/ports/service-catalog";
import { AREAS, resolveArea, resolveService, SERVICES } from "./seed/catalog";

/** The mock world's catalog: the same services and areas its search accepts. */
export const worldCatalog: ServiceCatalog = {
  services: () => SERVICES,
  areas: () => AREAS,
  resolveService,
  resolveArea,
};
