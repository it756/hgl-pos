import type { SupabaseClient } from "@supabase/supabase-js";
import { toRangeTimestamps, type ReportDateRange } from "./shared";

export type InventoryOnHandRow = {
  store_id: string;
  sku_id: string;
  qty_on_hand: number;
  qty_in_transit_out: number;
  qty_in_transit_in: number;
  is_oversold: boolean;
};

export type TransferHistoryRow = {
  transfer_id: string;
  source_store_id: string;
  destination_store_id: string;
  state: string;
  requested_at: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  last_event_server_ts: string | null;
};

export type CountCorrectionRow = {
  event_id: string;
  store_id: string;
  sku_id: string;
  delta_qty: number;
  reason_code: string | null;
  server_ts: string;
  notes: string | null;
};

export type ShrinkageRow = {
  event_id: string;
  store_id: string;
  sku_id: string;
  event_type: string;
  delta_qty: number;
  reason_code: string | null;
  server_ts: string;
};

export type InventoryReport = {
  onHand: InventoryOnHandRow[];
  transferHistory: TransferHistoryRow[];
  /** Count-correction events (FR-030 requires these shown separately from other shrinkage causes). */
  countCorrections: CountCorrectionRow[];
  /** Shrinkage from causes other than a physical count correction — negative adjustments and transfer variance shortfalls. */
  otherShrinkage: ShrinkageRow[];
};

export type InventoryReportParams = {
  range: ReportDateRange;
  storeId?: string;
};

export async function loadInventoryReport(supabase: SupabaseClient, params: InventoryReportParams): Promise<InventoryReport> {
  const { fromTs, toTs } = toRangeTimestamps(params.range);

  let onHandQuery = supabase
    .from("current_stock_by_store_sku")
    .select("store_id, sku_id, qty_on_hand, qty_in_transit_out, qty_in_transit_in, is_oversold");
  if (params.storeId !== undefined) onHandQuery = onHandQuery.eq("store_id", params.storeId);

  let transfersQuery = supabase
    .from("transfers")
    .select("transfer_id, source_store_id, destination_store_id, state, requested_at, dispatched_at, received_at, last_event_server_ts")
    .gte("last_event_server_ts", fromTs)
    .lt("last_event_server_ts", toTs);
  if (params.storeId !== undefined) {
    transfersQuery = transfersQuery.or(`source_store_id.eq.${params.storeId},destination_store_id.eq.${params.storeId}`);
  }

  // event_type in ('adjustment', 'count_correction', 'transfer_variance') is the
  // shrinkage-relevant slice of stock_events; sale/refund/transfer_out/transfer_in
  // are ordinary stock movement, not shrinkage.
  let shrinkageQuery = supabase
    .from("stock_events")
    .select("event_id, store_id, sku_id, event_type, delta_qty, reason_code, server_ts, notes")
    .in("event_type", ["adjustment", "count_correction", "transfer_variance"])
    .gte("server_ts", fromTs)
    .lt("server_ts", toTs);
  if (params.storeId !== undefined) shrinkageQuery = shrinkageQuery.eq("store_id", params.storeId);

  const [onHandResult, transfersResult, shrinkageResult] = await Promise.all([onHandQuery, transfersQuery, shrinkageQuery]);

  if (onHandResult.error !== null) throw new Error(`Failed to load on-hand stock: ${onHandResult.error.message}`);
  if (transfersResult.error !== null) throw new Error(`Failed to load transfer history: ${transfersResult.error.message}`);
  if (shrinkageResult.error !== null) throw new Error(`Failed to load shrinkage events: ${shrinkageResult.error.message}`);

  const onHand: InventoryOnHandRow[] = onHandResult.data ?? [];
  const transferHistory: TransferHistoryRow[] = transfersResult.data ?? [];
  const shrinkageEvents: (ShrinkageRow & { notes: string | null })[] = shrinkageResult.data ?? [];

  const countCorrections: CountCorrectionRow[] = shrinkageEvents
    .filter((event) => event.event_type === "count_correction")
    .map((event) => ({
      event_id: event.event_id,
      store_id: event.store_id,
      sku_id: event.sku_id,
      delta_qty: event.delta_qty,
      reason_code: event.reason_code,
      server_ts: event.server_ts,
      notes: event.notes,
    }));

  const otherShrinkage: ShrinkageRow[] = shrinkageEvents
    .filter((event) => event.event_type !== "count_correction")
    .map((event) => ({
      event_id: event.event_id,
      store_id: event.store_id,
      sku_id: event.sku_id,
      event_type: event.event_type,
      delta_qty: event.delta_qty,
      reason_code: event.reason_code,
      server_ts: event.server_ts,
    }));

  return { onHand, transferHistory, countCorrections, otherShrinkage };
}
