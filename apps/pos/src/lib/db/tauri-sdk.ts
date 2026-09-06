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
    return this.#db.getAll<Row>(sql, [...parameters]);
  }

  async insert(sql: string, parameters: SqlParameters = [], _options?: QueryOptions): Promise<void> {
    await this.init();
    await this.#db.execute(sql, [...parameters]);
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
