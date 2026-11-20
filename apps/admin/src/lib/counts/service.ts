import type { SupabaseClient } from "@supabase/supabase-js";

export type CountStatus = "open" | "submitted" | "cancelled";

export type CountSummary = {
  count_id: string;
  store_id: string;
  category_id: string | null;
  status: CountStatus;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
  created_by_name: string | null;
  lines_total: number;
  lines_counted: number;
};

export type CountLine = {
  sku_id: string;
  code: string;
  name: string;
  expected_qty: number;
  counted_qty: number | null;
  correction_qty: number | null;
  counted_at: string | null;
};

export type CountDetail = Omit<CountSummary, "lines_total" | "lines_counted"> & { lines: CountLine[] };

type CountRow = Omit<CountSummary, "created_by_name" | "lines_total" | "lines_counted"> & {
  creator: { full_name: string } | { full_name: string }[] | null;
  stock_count_lines: { counted_qty: number | null }[] | null;
};

const COUNT_COLUMNS =
  "count_id, store_id, category_id, status, notes, created_at, closed_at, creator:users!stock_counts_created_by_user_id_fkey(full_name)";

function creatorName(row: CountRow): string | null {
  const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
  return creator?.full_name ?? null;
}

export async function listCounts(supabase: SupabaseClient, limit = 100): Promise<CountSummary[]> {
  const { data, error } = await supabase
    .from("stock_counts")
    .select(`${COUNT_COLUMNS}, stock_count_lines(counted_qty)`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) throw new Error(`Failed to load stock counts: ${error.message}`);
  return ((data ?? []) as unknown as CountRow[]).map((row) => {
    const lines = row.stock_count_lines ?? [];
    return {
      count_id: row.count_id,
      store_id: row.store_id,
      category_id: row.category_id,
      status: row.status,
      notes: row.notes,
      created_at: row.created_at,
      closed_at: row.closed_at,
      created_by_name: creatorName(row),
      lines_total: lines.length,
      lines_counted: lines.filter((line) => line.counted_qty !== null).length,
    };
  });
}

type LineRow = Omit<CountLine, "code" | "name"> & { skus: { code: string; name: string } | { code: string; name: string }[] | null };

export async function loadCount(supabase: SupabaseClient, countId: string): Promise<CountDetail | null> {
  const [countResult, linesResult] = await Promise.all([
    supabase.from("stock_counts").select(COUNT_COLUMNS).eq("count_id", countId).maybeSingle(),
    supabase
      .from("stock_count_lines")
      .select("sku_id, expected_qty, counted_qty, correction_qty, counted_at, skus(code, name)")
      .eq("count_id", countId),
  ]);
  if (countResult.error !== null) throw new Error(`Failed to load stock count: ${countResult.error.message}`);
  if (linesResult.error !== null) throw new Error(`Failed to load count lines: ${linesResult.error.message}`);
  if (countResult.data === null) return null;

  const row = countResult.data as unknown as CountRow;
  const lines = ((linesResult.data ?? []) as unknown as LineRow[])
    .map((line) => {
      const sku = Array.isArray(line.skus) ? line.skus[0] : line.skus;
      return {
        sku_id: line.sku_id,
        code: sku?.code ?? line.sku_id,
        name: sku?.name ?? "",
        expected_qty: Number(line.expected_qty),
        counted_qty: line.counted_qty === null ? null : Number(line.counted_qty),
        correction_qty: line.correction_qty === null ? null : Number(line.correction_qty),
        counted_at: line.counted_at,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    count_id: row.count_id,
    store_id: row.store_id,
    category_id: row.category_id,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    closed_at: row.closed_at,
    created_by_name: creatorName(row),
    lines,
  };
}

// Variance shown while counting is against the snapshot; the submitted
// correction is recomputed server-side against current stock.
export function lineVariance(line: Pick<CountLine, "expected_qty" | "counted_qty">): number | null {
  return line.counted_qty === null ? null : Math.round((line.counted_qty - line.expected_qty) * 1000) / 1000;
}

export function parseCountedValue(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : "invalid";
}
