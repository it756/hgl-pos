// Placeholder — Drizzle Postgres + SQLite table definitions ship in T037 (SQLite
// schema on the till) and T019 (Postgres migrations). Both consume this package
// for shared column types (e.g. Money, Qty) so drift is caught at compile time.

export const SCHEMA_VERSION = 1 as const;
