export type SqlValue = string | number | boolean | null | Uint8Array;
export type SqlParameters = readonly SqlValue[];

export type QueryOptions = {
  signal?: AbortSignal;
};

export type WatchQuery<Row> = {
  sql: string;
  parameters?: SqlParameters;
  onRows: (rows: Row[]) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
};

export type Unsubscribe = () => void;

export interface IDb {
  init(): Promise<void>;
  query<Row extends Record<string, unknown>>(sql: string, parameters?: SqlParameters, options?: QueryOptions): Promise<Row[]>;
  insert(sql: string, parameters?: SqlParameters, options?: QueryOptions): Promise<void>;
  watch<Row extends Record<string, unknown>>(query: WatchQuery<Row>): Unsubscribe;
  close(): Promise<void>;
}
