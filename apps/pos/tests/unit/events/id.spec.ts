import { describe, expect, it } from "vitest";
import type { IDb, SqlParameters, WatchQuery, Unsubscribe } from "../../../src/lib/db/interface";
import { nextEventId } from "../../../src/lib/events/id";

// Minimal in-memory IDb fake — only supports the exact statements id.ts
// issues against local_event_sequence; not a general SQL engine.
class FakeLocalSequenceDb implements IDb {
  #sequenceByTill = new Map<string, number>();

  async init(): Promise<void> {}

  async query<Row extends Record<string, unknown>>(sql: string, parameters: SqlParameters = []): Promise<Row[]> {
    if (sql.includes("UPDATE local_event_sequence")) {
      const tillId = String(parameters[0]);
      const next = (this.#sequenceByTill.get(tillId) ?? 0) + 1;
      this.#sequenceByTill.set(tillId, next);
      return [{ next_seq: next } as unknown as Row];
    }
    throw new Error(`FakeLocalSequenceDb: unsupported query: ${sql}`);
  }

  async insert(sql: string, parameters: SqlParameters = []): Promise<void> {
    if (sql.includes("CREATE TABLE")) return;
    if (sql.includes("INSERT INTO local_event_sequence")) {
      const tillId = String(parameters[0]);
      if (!this.#sequenceByTill.has(tillId)) this.#sequenceByTill.set(tillId, 0);
      return;
    }
    throw new Error(`FakeLocalSequenceDb: unsupported insert: ${sql}`);
  }

  watch<Row extends Record<string, unknown>>(_query: WatchQuery<Row>): Unsubscribe {
    return () => {};
  }

  async close(): Promise<void> {}
}

describe("nextEventId", () => {
  it("increments a durable per-till sequence and returns a valid v5 UUID", async () => {
    const db = new FakeLocalSequenceDb();
    const first = await nextEventId(db, "till-a");
    const second = await nextEventId(db, "till-a");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is deterministic for the same till_id + sequence pair", async () => {
    const dbA = new FakeLocalSequenceDb();
    const dbB = new FakeLocalSequenceDb();

    const idA = await nextEventId(dbA, "till-shared");
    const idB = await nextEventId(dbB, "till-shared");

    expect(idA).toBe(idB);
  });

  it(
    "produces zero colliding event_ids across two independently-provisioned tills sharing cloned starting state, even at high volume",
    async () => {
      const tillA = new FakeLocalSequenceDb();
      const tillB = new FakeLocalSequenceDb();
      const seen = new Set<string>();
      let collisions = 0;

      for (let i = 0; i < 10_000; i += 1) {
        const idA = await nextEventId(tillA, "till-aaaaaaaa-0000-4000-8000-000000000001");
        const idB = await nextEventId(tillB, "till-bbbbbbbb-0000-4000-8000-000000000002");

        for (const id of [idA, idB]) {
          if (seen.has(id)) collisions += 1;
          seen.add(id);
        }
      }

      expect(collisions).toBe(0);
    },
    60_000,
  );
});
