import { PowerSyncTauriDatabase } from "@powersync/tauri-plugin";
import type { Schema } from "@powersync/common";
import type { IDb, QueryOptions, SqlParameters, Unsubscribe, WatchQuery } from "./interface";

export type TauriSdkDbOptions = {
  schema: Schema;
  dbFilename?: string;
  dbLocationAsync: () => Promise<string>;
  database?: PowerSyncTauriDatabase;
};

export class TauriSdkDb implements IDb {
  readonly #db: PowerSyncTauriDatabase;
  #initialized = false;
  // Serializes every call into the native bridge: the PowerSync Tauri plugin
  // (0.0.6, alpha) can corrupt its read/write connection state under
  // concurrent access — e.g. a background poll's getAll() racing a page's
  // execute() — surfacing as "SQLite: attempt to write a readonly database"
  // on an otherwise-valid write. A single promise chain avoids any overlap.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: TauriSdkDbOptions) {
    this.#db = options.database ?? new PowerSyncTauriDatabase({
      schema: options.schema,
      database: {
        dbFilename: options.dbFilename ?? "powersync.db",
        dbLocationAsync: options.dbLocationAsync,
      },
    });
  }

  get raw(): PowerSyncTauriDatabase {
    return this.#db;
  }

  async init(): Promise<void> {
    if (this.#initialized) return;

    await this.#db.init();
    this.#initialized = true;
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: SqlParameters = [],
    _options?: QueryOptions,
  ): Promise<Row[]> {
    await this.init();
    return this.#enqueue(() => this.#db.getAll<Row>(sql, [...parameters]));
  }

  async insert<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: SqlParameters = [],
    _options?: QueryOptions,
  ): Promise<Row[]> {
    await this.init();
    const result = await this.#enqueue(() => this.#db.execute<Row>(sql, [...parameters]));
    return result.array;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    // Swallow rejections here only to keep the chain alive for the NEXT
    // operation — the real rejection still propagates via `result` above.
    this.#queue = result.catch(() => undefined);
    return result;
  }

  watch<Row extends Record<string, unknown>>(query: WatchQuery<Row>): Unsubscribe {
    let active = true;

    void this.query<Row>(query.sql, query.parameters, { signal: query.signal })
      .then((rows) => {
        if (active && !query.signal?.aborted) query.onRows(rows);
      })
      .catch((error: unknown) => {
        if (!active || query.signal?.aborted) return;
        query.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

    return () => {
      active = false;
    };
  }

  async close(): Promise<void> {
    await this.#db.close();
    this.#initialized = false;
  }
}
