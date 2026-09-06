import type { IDb, QueryOptions, SqlParameters, Unsubscribe, WatchQuery } from "./interface";

export type SidecarDbOptions = {
  endpoint: string;
  fetchImpl?: typeof fetch;
};

type SidecarQueryResponse<Row> = {
  rows: Row[];
};

export class SidecarDb implements IDb {
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: SidecarDbOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async init(): Promise<void> {
    await this.request("/health", {}, {});
  }

  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: SqlParameters = [],
    options: QueryOptions = {},
  ): Promise<Row[]> {
    const response = await this.request<SidecarQueryResponse<Row>>("/query", { sql, parameters }, options);
    return response.rows;
  }

  async insert(sql: string, parameters: SqlParameters = [], options: QueryOptions = {}): Promise<void> {
    await this.request("/execute", { sql, parameters }, options);
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
    await this.request("/close", {}, {});
  }

  async request<ResponseBody>(path: string, body: unknown, options: QueryOptions): Promise<ResponseBody> {
    const response = await this.#fetch(`${this.#endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`PowerSync sidecar request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<ResponseBody>;
  }
}
