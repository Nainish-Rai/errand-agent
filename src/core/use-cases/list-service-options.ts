import type { ProviderWorld, ServiceOptions } from "../ports/provider-world";

/** The services and kinds of service the person can pick from, with the world's facts and image keys. */
export function listServiceOptions(world: ProviderWorld): Promise<ServiceOptions> {
  return world.listServiceOptions();
}
