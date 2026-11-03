import { randomUUID } from "node:crypto";

import type { MemoryFact, MemoryKey, OwnerMemory, Tombstone, TrustedEvidence } from "../../core/memory/memory-fact";
import type { MemoryChange, MemoryStore } from "../../core/ports/memory-store";
import { migrate, type Database, type Migration } from "./database";

// Memory facts and tombstones in the shared SQLite file. A fact row is append-only in what it says:
// a trigger refuses any update of its owner, key, value, source or evidence, so a correction can
// only ever be a new row. Only its lifecycle columns (status, valid_to, superseded_by, confirmation)
// change.

export const MEMORY_MIGRATIONS: readonly Migration[] = [
  {
    id: "1100_memory_facts",
    sql: `
      CREATE TABLE memory_facts (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('explicit', 'inferred')),
        status TEXT NOT NULL CHECK (status IN ('active', 'pending_confirmation', 'superseded', 'forgotten')),
        evidence TEXT NOT NULL,
        valid_from_ms INTEGER NOT NULL,
        valid_to_ms INTEGER,
        supersedes TEXT,
        superseded_by TEXT,
        confirmation TEXT
      );
      CREATE INDEX memory_facts_by_owner ON memory_facts (owner_id, key);
      CREATE TRIGGER memory_facts_say_what_they_said
      BEFORE UPDATE OF owner_id, key, value, source, evidence, valid_from_ms, supersedes ON memory_facts
      BEGIN
        SELECT RAISE(ABORT, 'memory facts are never edited in place; supersede them');
      END;
    `,
  },
  {
    id: "1101_memory_tombstones",
    sql: `
      CREATE TABLE memory_tombstones (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        key TEXT NOT NULL,
        forgotten_at_ms INTEGER NOT NULL,
        evidence TEXT NOT NULL
      );
      CREATE INDEX memory_tombstones_by_owner ON memory_tombstones (owner_id, key);
    `,
  },
];

interface FactRow {
  readonly id: string;
  readonly owner_id: string;
  readonly key: string;
  readonly value: string;
  readonly source: string;
  readonly status: string;
  readonly evidence: string;
  readonly valid_from_ms: number;
  readonly valid_to_ms: number | null;
  readonly supersedes: string | null;
  readonly superseded_by: string | null;
  readonly confirmation: string | null;
}

interface TombstoneRow {
  readonly owner_id: string;
  readonly key: string;
  readonly forgotten_at_ms: number;
  readonly evidence: string;
}

function factFrom(row: FactRow): MemoryFact {
  return {
    id: row.id,
    ownerId: row.owner_id,
    key: row.key as MemoryKey,
    value: row.value,
    source: row.source as MemoryFact["source"],
    status: row.status as MemoryFact["status"],
    evidence: JSON.parse(row.evidence) as TrustedEvidence,
    validFromMs: row.valid_from_ms,
    ...(row.valid_to_ms === null ? {} : { validToMs: row.valid_to_ms }),
    ...(row.supersedes === null ? {} : { supersedes: row.supersedes }),
    ...(row.superseded_by === null ? {} : { supersededBy: row.superseded_by }),
    ...(row.confirmation === null ? {} : { confirmation: JSON.parse(row.confirmation) as MemoryFact["confirmation"] }),
  };
}

function tombstoneFrom(row: TombstoneRow): Tombstone {
  return {
    ownerId: row.owner_id,
    key: row.key as MemoryKey,
    forgottenAtMs: row.forgotten_at_ms,
    evidence: JSON.parse(row.evidence) as TrustedEvidence,
  };
}

export class SqliteMemoryStore implements MemoryStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    migrate(db, MEMORY_MIGRATIONS);
  }

  async read(ownerId: string): Promise<OwnerMemory> {
    return this.#read(ownerId);
  }

  async change<T>(ownerId: string, change: (memory: OwnerMemory) => MemoryChange<T>): Promise<T> {
    // node:sqlite is synchronous, so the read, the decision and the writes run as one transaction
    // with nothing else interleaved.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const { save, tombstones, result } = change(this.#read(ownerId));
      for (const fact of save) this.#save(ownerId, fact);
      for (const tombstone of tombstones) this.#bury(ownerId, tombstone);
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  async replace(ownerId: string, memory: OwnerMemory): Promise<void> {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM memory_facts WHERE owner_id = ?").run(ownerId);
      this.#db.prepare("DELETE FROM memory_tombstones WHERE owner_id = ?").run(ownerId);
      for (const fact of memory.facts) this.#save(ownerId, fact);
      for (const tombstone of memory.tombstones) this.#bury(ownerId, tombstone);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  newFactId(): string {
    return `fact_${randomUUID()}`;
  }

  #read(ownerId: string): OwnerMemory {
    const facts = this.#db.prepare("SELECT * FROM memory_facts WHERE owner_id = ? ORDER BY seq").all(ownerId) as unknown as FactRow[];
    const tombstones = this.#db
      .prepare("SELECT * FROM memory_tombstones WHERE owner_id = ? ORDER BY seq")
      .all(ownerId) as unknown as TombstoneRow[];
    return { facts: facts.map(factFrom), tombstones: tombstones.map(tombstoneFrom) };
  }

  #save(ownerId: string, fact: MemoryFact): void {
    if (fact.ownerId !== ownerId) throw new Error(`A fact of ${fact.ownerId} can't be saved under ${ownerId}.`);
    this.#db
      .prepare(
        `INSERT INTO memory_facts (id, owner_id, key, value, source, status, evidence, valid_from_ms, valid_to_ms, supersedes, superseded_by, confirmation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           status = excluded.status,
           valid_to_ms = excluded.valid_to_ms,
           superseded_by = excluded.superseded_by,
           confirmation = excluded.confirmation`,
      )
      .run(
        fact.id,
        fact.ownerId,
        fact.key,
        fact.value,
        fact.source,
        fact.status,
        JSON.stringify(fact.evidence),
        fact.validFromMs,
        fact.validToMs ?? null,
        fact.supersedes ?? null,
        fact.supersededBy ?? null,
        fact.confirmation === undefined ? null : JSON.stringify(fact.confirmation),
      );
  }

  #bury(ownerId: string, tombstone: Tombstone): void {
    this.#db
      .prepare("INSERT INTO memory_tombstones (owner_id, key, forgotten_at_ms, evidence) VALUES (?, ?, ?, ?)")
      .run(ownerId, tombstone.key, tombstone.forgottenAtMs, JSON.stringify(tombstone.evidence));
  }
}
