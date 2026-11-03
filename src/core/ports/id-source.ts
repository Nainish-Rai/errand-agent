/** Identifiers for what core creates (proposals, grants): unguessable, and never handed out twice. */
export interface IdSource {
  /** A fresh id that starts with `prefix` and an underscore, e.g. `prp_3f9c0a…`. */
  next(prefix: string): string;
}
