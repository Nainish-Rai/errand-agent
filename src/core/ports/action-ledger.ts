import type { ActionIntent } from "../booking/action-intent";

export interface ActionIntentQuery {
  readonly sessionId?: string;
  readonly userId?: string;
  readonly grantId?: string;
}

/**
 * The action ledger: one intent per idempotency key, written before the side effect. Must survive a
 * restart. Every write is decided atomically in the store, so an execution and the reconciler (or
 * two executions) working on the same intent can't overwrite each other.
 */
export interface ActionLedger {
  /**
   * Stores the intent unless one with its key exists, and returns the stored one. The key names the
   * action (`book:…`, `cancel:…`), so the stored intent is always the same kind as `intent`.
   */
  record<T extends ActionIntent>(intent: T): Promise<T>;
  find(idempotencyKey: string): Promise<ActionIntent | undefined>;
  /**
   * Saves `next` only if the stored intent is still at `next.version - 1`. False when someone else
   * changed it first; read it again and decide from what is stored.
   */
  advance(next: ActionIntent): Promise<boolean>;
  /** Pending and unknown intents, oldest first. */
  unresolved(query?: ActionIntentQuery): Promise<readonly ActionIntent[]>;
  /** Oldest first. */
  list(query: ActionIntentQuery): Promise<readonly ActionIntent[]>;
  /** Dev only: the world was reseeded, so every intent names holds and keys the new world never saw. */
  discardAll(): Promise<void>;
}
