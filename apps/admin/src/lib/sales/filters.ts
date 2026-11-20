import type { SupabaseClient } from "@supabase/supabase-js";

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SalesFilters = {
  from: string;
  to: string;
  storeId: string | null;
  tillId: string | null;
  cashierId: string | null;
  shiftId: string | null;
  status: "completed" | "voided" | "refunded" | null;
  minTotal: number | null;
  maxTotal: number | null;
  page: number;
};

export type ShiftFilters = Pick<SalesFilters, "from" | "to" | "storeId" | "tillId" | "cashierId" | "page"> & {
  status: "open" | "closed" | null;
  discrepancyOnly: boolean;
};

function one(params: SearchParams, key: string): string | null {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === "string" && single.trim() !== "" ? single.trim() : null;
}

function uuidParam(params: SearchParams, key: string): string | null {
  const value = one(params, key);
  return value !== null && UUID.test(value) ? value : null;
}

function numberParam(params: SearchParams, key: string): number | null {
  const value = one(params, key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Defaults to the last 7 days; an inverted range is swapped rather than
// rejected so a hand-edited URL still shows something sensible.
function dateRange(params: SearchParams, now: Date): { from: string; to: string } {
  const fromRaw = one(params, "from");
  const toRaw = one(params, "to");
  let from = fromRaw !== null && DATE.test(fromRaw) ? fromRaw : isoDay(new Date(now.getTime() - 6 * 86_400_000));
  let to = toRaw !== null && DATE.test(toRaw) ? toRaw : isoDay(now);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function pageParam(params: SearchParams): number {
  const page = Math.trunc(numberParam(params, "page") ?? 1);
  return page >= 1 ? page : 1;
}

export function parseSalesFilters(params: SearchParams, now: Date = new Date()): SalesFilters {
  const status = one(params, "status");
  return {
    ...dateRange(params, now),
    storeId: uuidParam(params, "store_id"),
    tillId: uuidParam(params, "till_id"),
    cashierId: uuidParam(params, "cashier_id"),
    shiftId: uuidParam(params, "shift_id"),
    status: status === "completed" || status === "voided" || status === "refunded" ? status : null,
    minTotal: numberParam(params, "min_total"),
    maxTotal: numberParam(params, "max_total"),
    page: pageParam(params),
  };
}

export function parseShiftFilters(params: SearchParams, now: Date = new Date()): ShiftFilters {
  const status = one(params, "status");
  return {
    ...dateRange(params, now),
    storeId: uuidParam(params, "store_id"),
    tillId: uuidParam(params, "till_id"),
    cashierId: uuidParam(params, "cashier_id"),
    status: status === "open" || status === "closed" ? status : null,
    discrepancyOnly: one(params, "discrepancy") === "1",
    page: pageParam(params),
  };
}

// Inclusive day range as [fromTs, toTsExclusive) in UTC, matching the
// existing reports' day semantics (lib/reports/shared.ts).
export function dayBounds(from: string, to: string): { fromTs: string; toTs: string } {
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { fromTs: new Date(`${from}T00:00:00.000Z`).toISOString(), toTs: end.toISOString() };
}

export function toQueryString(filters: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export type LookupMaps = {
  stores: Map<string, string>;
  tills: Map<string, { label: string; store_id: string }>;
  users: Map<string, string>;
};

export type LookupLists = {
  stores: { id: string; name: string }[];
  tills: { id: string; label: string; store_id: string }[];
  cashiers: { id: string; name: string; store_id: string | null }[];
};

export async function loadLookups(supabase: SupabaseClient): Promise<{ maps: LookupMaps; lists: LookupLists }> {
  const [stores, tills, users] = await Promise.all([
    supabase.from("stores").select("store_id, name").order("name"),
    supabase.from("tills").select("till_id, label, store_id").order("label"),
    supabase.from("users").select("user_id, full_name, role, store_id").order("full_name"),
  ]);
  if (stores.error !== null) throw new Error(`Failed to load stores: ${stores.error.message}`);
  if (tills.error !== null) throw new Error(`Failed to load tills: ${tills.error.message}`);
  if (users.error !== null) throw new Error(`Failed to load users: ${users.error.message}`);

  const storeRows = (stores.data ?? []) as { store_id: string; name: string }[];
  const tillRows = (tills.data ?? []) as { till_id: string; label: string; store_id: string }[];
  const userRows = (users.data ?? []) as { user_id: string; full_name: string; role: string; store_id: string | null }[];

  return {
    maps: {
      stores: new Map(storeRows.map((row) => [row.store_id, row.name])),
      tills: new Map(tillRows.map((row) => [row.till_id, { label: row.label, store_id: row.store_id }])),
      users: new Map(userRows.map((row) => [row.user_id, row.full_name])),
    },
    lists: {
      stores: storeRows.map((row) => ({ id: row.store_id, name: row.name })),
      tills: tillRows.map((row) => ({ id: row.till_id, label: row.label, store_id: row.store_id })),
      cashiers: userRows.filter((row) => row.role === "cashier").map((row) => ({ id: row.user_id, name: row.full_name, store_id: row.store_id })),
    },
  };
}
