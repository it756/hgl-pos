import type { IDb, SqlParameters, SqlValue, Unsubscribe, WatchQuery } from "../../src/lib/db/interface";

// Shared in-memory `IDb` fake for integration-style Vitest tests (T061,
// T148, T149). Unlike the narrower single-purpose fakes under
// tests/unit/**/*.spec.ts (e.g. events/id.spec.ts's FakeLocalSequenceDb),
// this one supports the general — but still single-table, no-join — SQL
// shapes issued across apps/pos/src/lib/{auth,events,sync,time}/*.ts:
// CREATE TABLE/INDEX, INSERT [ON CONFLICT DO NOTHING|UPDATE SET], UPDATE
// [WHERE] [RETURNING], SELECT [WHERE] [ORDER BY] [LIMIT], DELETE [WHERE].
// It is NOT a general SQL engine — extend the helpers below if a new
// module needs a shape this doesn't already parse.

type Row = Record<string, SqlValue>;
type NextParam = () => SqlValue;

type ResolvedCondition =
  | { col: string; op: "="; value: SqlValue }
  | { col: string; op: "<=" | ">=" | "<" | ">"; value: number | string }
  | { col: string; op: "in"; values: SqlValue[] }
  | { col: string; op: "is_null" | "is_not_null" }
  | { op: "or"; conditions: ResolvedCondition[] };

export class MemoryDb implements IDb {
  readonly #tables = new Map<string, Map<string, Row>>();
  readonly #primaryKeys = new Map<string, string>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  watch<R extends Record<string, unknown>>(_query: WatchQuery<R>): Unsubscribe {
    return () => {};
  }

  async insert(sql: string, parameters: SqlParameters = []): Promise<void> {
    this.#exec(sql, parameters);
  }

  async query<R extends Record<string, unknown>>(sql: string, parameters: SqlParameters = []): Promise<R[]> {
    return this.#exec(sql, parameters) as unknown as R[];
  }

  /** Test-only direct seed, bypassing SQL parsing entirely. */
  seed(table: string, primaryKey: string, row: Row): void {
    this.#table(table, primaryKey).set(String(row[primaryKey]), { ...row });
  }

  #table(name: string, primaryKeyFallback: string): Map<string, Row> {
    if (!this.#primaryKeys.has(name)) this.#primaryKeys.set(name, primaryKeyFallback);
    let table = this.#tables.get(name);
    if (table === undefined) {
      table = new Map();
      this.#tables.set(name, table);
    }
    return table;
  }

  #exec(sql: string, parameters: SqlParameters): Row[] {
    const collapsed = sql.replace(/\s+/g, " ").trim();

    if (/^CREATE TABLE/i.test(collapsed)) {
      const nameMatch = /^CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(collapsed);
      if (nameMatch?.[1] === undefined) throw new Error(`MemoryDb: unparseable CREATE TABLE: ${sql}`);
      const pkMatch = /(\w+)\s+\S+\s+PRIMARY KEY/i.exec(sql);
      this.#table(nameMatch[1], pkMatch?.[1] ?? "id");
      return [];
    }
    if (/^CREATE (UNIQUE )?INDEX/i.test(collapsed)) return [];
    if (/^INSERT INTO/i.test(collapsed)) return this.#insert(collapsed, parameters);
    if (/^UPDATE/i.test(collapsed)) return this.#update(collapsed, parameters);
    if (/^SELECT/i.test(collapsed)) return this.#select(collapsed, parameters);
    if (/^DELETE FROM/i.test(collapsed)) return this.#delete(collapsed, parameters);

    throw new Error(`MemoryDb: unsupported statement: ${sql}`);
  }

  #insert(sql: string, parameters: SqlParameters): Row[] {
    const headMatch = /^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.exec(sql);
    if (headMatch?.[1] === undefined || headMatch[2] === undefined || headMatch[3] === undefined) {
      throw new Error(`MemoryDb: unparseable INSERT: ${sql}`);
    }
    const tableName = headMatch[1];
    const cols = splitTopLevel(headMatch[2]).map((c) => c.trim());
    let paramIndex = 0;
    const nextParam: NextParam = () => parameters[paramIndex++] ?? null;
    const values = splitTopLevel(headMatch[3]).map((token) => resolveValueToken(token.trim(), nextParam));

    const row: Row = {};
    cols.forEach((col, i) => (row[col] = values[i] ?? null));

    const pk = this.#primaryKeys.get(tableName) ?? cols[0] ?? "id";
    const table = this.#table(tableName, pk);
    const pkValue = String(row[pk]);

    // The ON CONFLICT target column is NOT necessarily the table's primary
    // key (e.g. local_upload_queue's PK is queue_id, but events dedupe on
    // its separate UNIQUE event_id column) — look up any existing row by
    // that column, not by primary key.
    const conflictMatch = /ON CONFLICT\s*\(([^)]+)\)\s*DO\s+(NOTHING|UPDATE SET ([\s\S]+))$/i.exec(sql);
    if (conflictMatch?.[1] !== undefined && conflictMatch[2] !== undefined) {
      const conflictCol = conflictMatch[1].trim();
      const doNothing = /^NOTHING$/i.test(conflictMatch[2]);
      const existing = Array.from(table.values()).find((candidate) => candidate[conflictCol] === row[conflictCol]);
      if (existing !== undefined) {
        if (doNothing) return [];
        const assignmentsRaw = conflictMatch[3];
        if (assignmentsRaw === undefined) throw new Error(`MemoryDb: unparseable ON CONFLICT DO UPDATE: ${sql}`);
        for (const [col, rhs] of parseAssignments(assignmentsRaw)) {
          existing[col] = resolveConflictRhs(rhs, row, existing);
        }
        return [];
      }
    }

    table.set(pkValue, row);
    return [];
  }

  #update(sql: string, parameters: SqlParameters): Row[] {
    const returningMatch = /\sRETURNING\s+([\s\S]+)$/i.exec(sql);
    const body = returningMatch !== null ? sql.slice(0, returningMatch.index) : sql;
    const returningCols = returningMatch?.[1] !== undefined ? splitTopLevel(returningMatch[1]).map((c) => c.trim()) : null;

    const whereMatch = /\sWHERE\s+([\s\S]+)$/i.exec(body);
    const setSection = whereMatch !== null ? body.slice(0, whereMatch.index) : body;
    const whereClause = whereMatch?.[1];

    const headMatch = /^UPDATE (\w+)\s+SET\s+([\s\S]+)$/i.exec(setSection);
    if (headMatch?.[1] === undefined || headMatch[2] === undefined) {
      throw new Error(`MemoryDb: unparseable UPDATE: ${sql}`);
    }
    const tableName = headMatch[1];

    let paramIndex = 0;
    const nextParam: NextParam = () => parameters[paramIndex++] ?? null;

    // Resolve assignment RHS values in textual order (matches param binding
    // order) BEFORE resolving the WHERE clause, which comes later in the SQL.
    const assignments = parseAssignments(headMatch[2]).map(([col, rhs]) => [col, resolveUpdateRhs(rhs, nextParam)] as const);
    const conditions = whereClause !== undefined ? resolveConditions(whereClause, nextParam) : [];

    const pk = this.#primaryKeys.get(tableName) ?? "id";
    const table = this.#table(tableName, pk);
    const returned: Row[] = [];

    for (const row of table.values()) {
      if (!rowMatches(row, conditions)) continue;
      for (const [col, valueOrFn] of assignments) {
        row[col] = typeof valueOrFn === "function" ? valueOrFn(row) : valueOrFn;
      }
      if (returningCols !== null) returned.push(pick(row, returningCols));
    }

    return returned;
  }

  #select(sql: string, parameters: SqlParameters): Row[] {
    const fromMatch = /^SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)/i.exec(sql);
    if (fromMatch?.[1] === undefined || fromMatch[2] === undefined || fromMatch.index === undefined) {
      throw new Error(`MemoryDb: unparseable SELECT: ${sql}`);
    }
    const selectCols = fromMatch[1].trim();
    const tableName = fromMatch[2];

    let rest = sql.slice(fromMatch.index + fromMatch[0].length);
    let limitToken: string | null = null;
    let orderBy: string | null = null;

    const limitMatch = /\sLIMIT\s+(\?|\d+)\s*$/i.exec(rest);
    if (limitMatch?.[1] !== undefined && limitMatch.index !== undefined) {
      limitToken = limitMatch[1];
      rest = rest.slice(0, limitMatch.index);
    }

    const orderMatch = /\sORDER BY\s+([\s\S]+)$/i.exec(rest);
    if (orderMatch?.[1] !== undefined && orderMatch.index !== undefined) {
      orderBy = orderMatch[1].trim();
      rest = rest.slice(0, orderMatch.index);
    }

    const whereMatch = /\sWHERE\s+([\s\S]+)$/i.exec(rest);
    const whereClause = whereMatch?.[1]?.trim();

    let paramIndex = 0;
    const nextParam: NextParam = () => parameters[paramIndex++] ?? null;
    const conditions = whereClause !== undefined ? resolveConditions(whereClause, nextParam) : [];
    const limitValue = limitToken === null ? null : Number(limitToken === "?" ? nextParam() : limitToken);

    const pk = this.#primaryKeys.get(tableName) ?? "id";
    const table = this.#table(tableName, pk);
    let rows = Array.from(table.values()).filter((row) => rowMatches(row, conditions));

    const aggregateMatch = /^(COUNT|MIN|MAX|SUM)\(([^)]*)\)\s+AS\s+(\w+)$/i.exec(selectCols);
    if (aggregateMatch?.[1] !== undefined && aggregateMatch[2] !== undefined && aggregateMatch[3] !== undefined) {
      return [computeAggregate(aggregateMatch[1], aggregateMatch[2], aggregateMatch[3], rows)];
    }

    if (orderBy !== null) {
      const orderKeys = orderBy.split(",").map((part) => parseOrderKey(part.trim()));
      rows = [...rows].sort((a, b) => {
        for (const key of orderKeys) {
          const cmp = key(a, b);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }

    if (limitValue !== null) rows = rows.slice(0, limitValue);

    if (selectCols === "*") return rows.map((row) => ({ ...row }));
    const cols = splitTopLevel(selectCols).map((c) => c.trim());
    return rows.map((row) => pick(row, cols));
  }

  #delete(sql: string, parameters: SqlParameters): Row[] {
    const match = /^DELETE FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?$/i.exec(sql);
    if (match?.[1] === undefined) throw new Error(`MemoryDb: unparseable DELETE: ${sql}`);
    const tableName = match[1];

    let paramIndex = 0;
    const nextParam: NextParam = () => parameters[paramIndex++] ?? null;
    const conditions = match[2] !== undefined ? resolveConditions(match[2], nextParam) : [];

    const pk = this.#primaryKeys.get(tableName) ?? "id";
    const table = this.#table(tableName, pk);
    for (const [key, row] of table.entries()) {
      if (rowMatches(row, conditions)) table.delete(key);
    }
    return [];
  }
}

export function createMemoryDb(): MemoryDb {
  return new MemoryDb();
}

// ---------- Parsing helpers ----------

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  for (const char of text) {
    if (char === "'") inQuote = !inQuote;
    if (char === "," && !inQuote) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function splitFirst(text: string, separator: string): [string, string] {
  const index = text.indexOf(separator);
  if (index === -1) throw new Error(`MemoryDb: expected "${separator}" in: ${text}`);
  return [text.slice(0, index), text.slice(index + separator.length)];
}

type OrderComparator = (a: Row, b: Row) => number;

// Supports both a plain column key (`col [ASC|DESC]`) and the
// `(col IS [NOT] NULL) [ASC|DESC]` idiom used by resolve.ts/promotions.ts to
// sort store-scoped rows before global/null-scoped ones.
function parseOrderKey(raw: string): OrderComparator {
  const nullCheckMatch = /^\((\w+)\s+IS\s+(NOT\s+)?NULL\)\s*(ASC|DESC)?$/i.exec(raw);
  if (nullCheckMatch?.[1] !== undefined) {
    const col = nullCheckMatch[1];
    const negate = nullCheckMatch[2] !== undefined;
    const dir = (nullCheckMatch[3] ?? "ASC").toUpperCase();
    return (a, b) => {
      const av = isNullish(a[col]) !== negate ? 1 : 0;
      const bv = isNullish(b[col]) !== negate ? 1 : 0;
      const cmp = av - bv;
      return dir === "DESC" ? -cmp : cmp;
    };
  }

  const simpleMatch = /^(\w+)\s*(ASC|DESC)?$/i.exec(raw);
  if (simpleMatch?.[1] === undefined) throw new Error(`MemoryDb: unparseable ORDER BY key: ${raw}`);
  const col = simpleMatch[1];
  const dir = (simpleMatch[2] ?? "ASC").toUpperCase();
  return (a, b) => {
    const av = a[col];
    const bv = b[col];
    const cmp = av === bv ? 0 : (av as string | number) < (bv as string | number) ? -1 : 1;
    return dir === "DESC" ? -cmp : cmp;
  };
}

function isNullish(value: SqlValue | undefined): boolean {
  return value === null || value === undefined;
}

function parseAssignments(text: string): Array<[string, string]> {
  return splitTopLevel(text).map((assignment) => {
    const [col, rhs] = splitFirst(assignment, "=");
    return [col.trim(), rhs.trim()];
  });
}

function resolveValueToken(token: string, nextParam: NextParam): SqlValue {
  if (token === "?") return nextParam();
  if (/^NULL$/i.test(token)) return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  const stringMatch = /^'(.*)'$/.exec(token);
  if (stringMatch?.[1] !== undefined) return stringMatch[1];
  throw new Error(`MemoryDb: unsupported value token: ${token}`);
}

function resolveConflictRhs(rhs: string, insertedRow: Row, existingRow: Row): SqlValue {
  const excludedMatch = /^excluded\.(\w+)$/i.exec(rhs);
  if (excludedMatch?.[1] !== undefined) return insertedRow[excludedMatch[1]] ?? null;

  // `col + excluded.col` — e.g. current_stock_by_store_sku's running
  // qty_on_hand accumulating the newly-inserted delta on conflict.
  const selfPlusExcludedMatch = /^(\w+)\s*([+-])\s*excluded\.(\w+)$/i.exec(rhs);
  if (
    selfPlusExcludedMatch?.[1] !== undefined &&
    selfPlusExcludedMatch[2] !== undefined &&
    selfPlusExcludedMatch[3] !== undefined
  ) {
    const sign = selfPlusExcludedMatch[2] === "-" ? -1 : 1;
    const current = Number(existingRow[selfPlusExcludedMatch[1]] ?? 0);
    const excludedValue = Number(insertedRow[selfPlusExcludedMatch[3]] ?? 0);
    return current + sign * excludedValue;
  }

  return resolveValueToken(rhs, () => {
    throw new Error(`MemoryDb: unexpected "?" in ON CONFLICT DO UPDATE assignment: ${rhs}`);
  });
}

type AssignmentValue = SqlValue | ((row: Row) => SqlValue);

function resolveUpdateRhs(rhs: string, nextParam: NextParam): AssignmentValue {
  const selfArithmeticMatch = /^(\w+)\s*\+\s*(-?\d+(?:\.\d+)?)$/.exec(rhs);
  if (selfArithmeticMatch?.[1] !== undefined && selfArithmeticMatch[2] !== undefined) {
    const col = selfArithmeticMatch[1];
    const delta = Number(selfArithmeticMatch[2]);
    return (row: Row) => Number(row[col] ?? 0) + delta;
  }

  // `col + ?` / `col - ?` — the delta comes from a bound parameter rather
  // than a literal (e.g. `shifts.system_cash = system_cash + ?`).
  const selfParamArithmeticMatch = /^(\w+)\s*([+-])\s*\?$/.exec(rhs);
  if (selfParamArithmeticMatch?.[1] !== undefined && selfParamArithmeticMatch[2] !== undefined) {
    const col = selfParamArithmeticMatch[1];
    const sign = selfParamArithmeticMatch[2] === "-" ? -1 : 1;
    const delta = Number(nextParam());
    return (row: Row) => Number(row[col] ?? 0) + sign * delta;
  }

  return resolveValueToken(rhs, nextParam);
}

// Splits a WHERE clause on top-level ` AND ` only — i.e. not inside a
// parenthesized OR-group like `(store_id = ? OR store_id IS NULL)`, which
// resolve.ts/promotions.ts use for nullable-scope columns.
function splitTopLevelAnd(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && text.slice(i, i + 5) === " AND ") {
      parts.push(current);
      current = "";
      i += 5;
      continue;
    }
    current += char;
    i += 1;
  }
  parts.push(current);
  return parts;
}

function resolveConditions(whereClause: string, nextParam: NextParam): ResolvedCondition[] {
  return splitTopLevelAnd(whereClause).map((part) => parseConditionGroup(part.trim(), nextParam));
}

function parseConditionGroup(raw: string, nextParam: NextParam): ResolvedCondition {
  const orGroupMatch = /^\(([\s\S]+)\)$/.exec(raw);
  if (orGroupMatch?.[1] !== undefined && /\sOR\s/i.test(orGroupMatch[1])) {
    const disjuncts = orGroupMatch[1].split(/\s+OR\s+/i).map((disjunct) => parseSingleCondition(disjunct.trim(), nextParam));
    return { op: "or", conditions: disjuncts };
  }
  return parseSingleCondition(raw, nextParam);
}

function parseSingleCondition(condition: string, nextParam: NextParam): ResolvedCondition {
  const isNullMatch = /^(\w+)\s+IS\s+(NOT\s+)?NULL$/i.exec(condition);
  if (isNullMatch?.[1] !== undefined) {
    return { col: isNullMatch[1], op: isNullMatch[2] !== undefined ? "is_not_null" : "is_null" };
  }

  const inMatch = /^(\w+)\s+IN\s*\(([^)]+)\)$/i.exec(condition);
  if (inMatch?.[1] !== undefined && inMatch[2] !== undefined) {
    const values = splitTopLevel(inMatch[2]).map((token) => resolveValueToken(token.trim(), nextParam));
    return { col: inMatch[1], op: "in", values };
  }

  const opMatch = /^(\w+)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(condition);
  if (opMatch?.[1] === undefined || opMatch[2] === undefined || opMatch[3] === undefined) {
    throw new Error(`MemoryDb: unsupported WHERE condition: ${condition}`);
  }
  const value = resolveValueToken(opMatch[3].trim(), nextParam);
  if (opMatch[2] === "=") return { col: opMatch[1], op: "=", value };
  return { col: opMatch[1], op: opMatch[2] as "<=" | ">=" | "<" | ">", value: value as number | string };
}

function rowMatches(row: Row, conditions: ResolvedCondition[]): boolean {
  return conditions.every((condition) => matchesCondition(row, condition));
}

function matchesCondition(row: Row, condition: ResolvedCondition): boolean {
  if (condition.op === "or") return condition.conditions.some((sub) => matchesCondition(row, sub));
  if (condition.op === "is_null") return isNullish(row[condition.col]);
  if (condition.op === "is_not_null") return !isNullish(row[condition.col]);
  if (condition.op === "in") return condition.values.includes(row[condition.col]);

  const lhs = row[condition.col];
  if (condition.op === "=") return lhs === condition.value;
  const left = lhs as number | string;
  switch (condition.op) {
    case "<=":
      return left <= condition.value;
    case ">=":
      return left >= condition.value;
    case "<":
      return left < condition.value;
    case ">":
      return left > condition.value;
  }
}

function pick(row: Row, cols: string[]): Row {
  const result: Row = {};
  for (const col of cols) result[col] = row[col] ?? null;
  return result;
}

function computeAggregate(fn: string, arg: string, alias: string, rows: Row[]): Row {
  if (fn.toUpperCase() === "COUNT") return { [alias]: rows.length };

  const col = arg.trim();
  const values = rows.map((row) => row[col]).filter((value): value is string | number => value !== null && value !== undefined);

  if (values.length === 0) return { [alias]: null };

  switch (fn.toUpperCase()) {
    case "MIN":
      return { [alias]: values.reduce((a, b) => (a < b ? a : b)) };
    case "MAX":
      return { [alias]: values.reduce((a, b) => (a > b ? a : b)) };
    case "SUM":
      return { [alias]: values.reduce((total: number, value) => total + Number(value), 0) };
    default:
      throw new Error(`MemoryDb: unsupported aggregate function: ${fn}`);
  }
}
