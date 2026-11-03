import type { Errand } from "../errand/errand";

/**
 * Every errand the system holds, for the home screen's overview. Kept apart from ErrandStore so the
 * session-scoped use cases (and their test stores) don't grow a query only the home screen needs.
 * Locally there is one person, so every errand is theirs; real auth adds the owner to the query.
 */
export interface ErrandIndex {
  listErrands(): Promise<readonly Errand[]>;
}
