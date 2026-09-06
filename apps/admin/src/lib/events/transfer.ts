import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SCHEMA_VERSION } from "@hgl/db-shared";
import { loadSkuOptions, loadStoreOptions, type SkuOption, type StoreOption } from "../catalog/options";

const ADMIN_APP_VERSION = "admin-web";

// transfer_events.till_id has no FK (0017_transfer_admin_console.sql) — HQ
// console/store-manager writes are stamped with this well-known value
// instead of a real till row, same precedent as price_change_events /
// adjustment_events. Duplicated locally (not imported) rather than shared:
// this file is also used by a "use client" dashboard component, and a file
// using `node:crypto`'s randomUUID (like prices/change.ts) would leak that
// server-only import into the browser bundle if re-exported across the
// boundary (see repo memory notes on adjustments/service.ts).
const HQ_CONSOLE_TILL_ID = "00000000-0000-4000-8000-000000000000";

export type { SkuOption, StoreOption };

// Deliberately NOT reusing @hgl/events' TransferLineItemSchema/TransferEventSchema:
// (1) apps/admin never writes through the shared till-event `kind`-discriminated
// schemas (see prices/change.ts, adjustments/service.ts) — those insert directly
// against the DB table shape instead, validated by a local schema. (2) The shared
// schema's `qty` is `.positive()`-only for BOTH line_items and variance_items,
// which cannot represent a shortage variance (data-model.md §2.4 documents
// `transfer_variance → stock_events(..., delta_qty=<signed>, ...)` — a negative
// delta for a shortfall). Since apps/pos doesn't produce transfer events yet,
// this is flagged as a follow-up for @hgl/events rather than fixed here (out of
// this task's scope) — see tasks.md implementation notes for T101.
export const TransferLineItemInputSchema = z.object({
  sku_id: z.string().uuid(),
  qty: z.number().finite().positive(),
});
export type TransferLineItemInput = z.infer<typeof TransferLineItemInputSchema>;

// Signed: negative = shortage (received < dispatched), positive = surplus.
// Zero is rejected — a no-op variance line should simply be omitted.
export const TransferVarianceLineItemInputSchema = z.object({
  sku_id: z.string().uuid(),
  qty: z.number().finite().refine((value) => value !== 0, { message: "variance qty must be non-zero" }),
});
export type TransferVarianceLineItemInput = z.infer<typeof TransferVarianceLineItemInputSchema>;

export type TransferState = "requested" | "dispatched" | "in_transit" | "received" | "received_with_variance";

export type PendingTransfer = {
  transfer_id: string;
  source_store_id: string;
  destination_store_id: string;
  state: TransferState;
  dispatched_line_items: TransferLineItemInput[] | null;
  received_line_items: TransferLineItemInput[] | null;
  variance_line_items: TransferVarianceLineItemInput[] | null;
  requested_at: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  last_event_server_ts: string | null;
};

const TRANSFER_COLUMNS =
  "transfer_id, source_store_id, destination_store_id, state, dispatched_line_items, received_line_items, variance_line_items, requested_at, dispatched_at, received_at, last_event_server_ts";

export async function loadTransferCatalog(supabase: SupabaseClient): Promise<{ skus: SkuOption[]; stores: StoreOption[] }> {
  const [skus, stores] = await Promise.all([loadSkuOptions(supabase), loadStoreOptions(supabase)]);
  return { skus, stores };
}

// `transfers_read` RLS (0009) already scopes rows to the caller's own store
// (as source or destination) for store_manager, or every store for hq_admin.
export async function listTransfers(supabase: SupabaseClient): Promise<PendingTransfer[]> {
  const { data, error } = await supabase
    .from("transfers")
    .select(TRANSFER_COLUMNS)
    .order("last_event_server_ts", { ascending: false, nullsFirst: false });
  if (error !== null) {
    throw new Error(`Failed to load transfers: ${error.message}`);
  }
  const rows: PendingTransfer[] = data ?? [];
  return rows;
}

// The `transfers` projection only stores `dispatched_line_items` onward —
// what was originally *requested* lives only in the transfer_requested
// event row itself, needed to pre-fill the dispatch form with what was
// asked for (the manager may still adjust it at dispatch time).
export async function loadTransferRequestLineItems(
  supabase: SupabaseClient,
  transferIds: string[],
): Promise<Record<string, TransferLineItemInput[]>> {
  if (transferIds.length === 0) return {};

  const { data, error } = await supabase
    .from("transfer_events")
    .select("transfer_id, line_items")
    .eq("event_kind", "transfer_requested")
    .in("transfer_id", transferIds);
  if (error !== null) {
    throw new Error(`Failed to load transfer requests: ${error.message}`);
  }

  const rows: { transfer_id: string; line_items: TransferLineItemInput[] }[] = data ?? [];
  const result: Record<string, TransferLineItemInput[]> = {};
  for (const row of rows) result[row.transfer_id] = row.line_items;
  return result;
}

type TransferEventKind = "transfer_requested" | "transfer_dispatched" | "transfer_received" | "transfer_variance";

type TransferEventInsert = {
  event_id: string;
  till_id: string;
  store_id: string;
  client_ts: string;
  app_version: string;
  schema_ver: number;
  transfer_id: string;
  event_kind: TransferEventKind;
  source_store_id: string;
  destination_store_id: string;
  line_items: TransferLineItemInput[];
  variance_items: TransferVarianceLineItemInput[] | null;
  actor_user_id: string;
};

async function insertTransferEvent(supabase: SupabaseClient, event: TransferEventInsert): Promise<void> {
  const { error } = await supabase.from("transfer_events").insert(event);
  if (error !== null) {
    throw new Error(`Failed to record ${event.event_kind}: ${error.message}`);
  }
}

export type RequestTransferInput = {
  sourceStoreId: string;
  destinationStoreId: string;
  lineItems: TransferLineItemInput[];
};

// store_manager only (`transfer_events_insert_by_manager`, 0009): source_store_id
// must equal the caller's own store. Mints a new transfer_id, reused across
// every later event_kind for this same transfer.
export async function requestTransfer(
  supabase: SupabaseClient,
  actorUserId: string,
  input: RequestTransferInput,
): Promise<{ transfer_id: string }> {
  const lineItems = z.array(TransferLineItemInputSchema).min(1).parse(input.lineItems);
  const transferId = crypto.randomUUID();

  await insertTransferEvent(supabase, {
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: input.sourceStoreId,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    transfer_id: transferId,
    event_kind: "transfer_requested",
    source_store_id: input.sourceStoreId,
    destination_store_id: input.destinationStoreId,
    line_items: lineItems,
    variance_items: null,
    actor_user_id: actorUserId,
  });

  return { transfer_id: transferId };
}

// store_manager only, source store: confirms the shipment has physically left
// the source store. `lineItems` may differ from the request (e.g. a
// short-pick) — this is what actually debits source stock (`transfer_out`)
// and opens the in-transit window (EC-04).
export async function dispatchTransfer(
  supabase: SupabaseClient,
  actorUserId: string,
  transfer: Pick<PendingTransfer, "transfer_id" | "source_store_id" | "destination_store_id">,
  lineItems: TransferLineItemInput[],
): Promise<void> {
  const parsed = z.array(TransferLineItemInputSchema).min(1).parse(lineItems);

  await insertTransferEvent(supabase, {
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: transfer.source_store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    transfer_id: transfer.transfer_id,
    event_kind: "transfer_dispatched",
    source_store_id: transfer.source_store_id,
    destination_store_id: transfer.destination_store_id,
    line_items: parsed,
    variance_items: null,
    actor_user_id: actorUserId,
  });
}

export type ReceiveTransferResult = {
  hasVariance: boolean;
};

// store_manager only, destination store: confirms the actual received qty per
// line. Always writes a `transfer_received` row using the ACTUAL received
// quantities (FR-014: transfer_in must equal what really arrived, never the
// dispatched amount) — and if any line's received qty differs from what was
// dispatched, a SEPARATE `transfer_variance` row is written in the same call,
// never merged into the transfer_received row (US4 acceptance scenario 1).
export async function receiveTransfer(
  supabase: SupabaseClient,
  actorUserId: string,
  transfer: Pick<PendingTransfer, "transfer_id" | "source_store_id" | "destination_store_id" | "dispatched_line_items">,
  receivedLineItems: TransferLineItemInput[],
): Promise<ReceiveTransferResult> {
  const parsedReceived = z.array(TransferLineItemInputSchema).min(1).parse(receivedLineItems);

  await insertTransferEvent(supabase, {
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: transfer.destination_store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    transfer_id: transfer.transfer_id,
    event_kind: "transfer_received",
    source_store_id: transfer.source_store_id,
    destination_store_id: transfer.destination_store_id,
    line_items: parsedReceived,
    variance_items: null,
    actor_user_id: actorUserId,
  });

  const varianceItems = computeVariance(transfer.dispatched_line_items ?? [], parsedReceived);
  if (varianceItems.length === 0) {
    return { hasVariance: false };
  }

  await insertTransferEvent(supabase, {
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: transfer.destination_store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    transfer_id: transfer.transfer_id,
    event_kind: "transfer_variance",
    source_store_id: transfer.source_store_id,
    destination_store_id: transfer.destination_store_id,
    // line_items on a transfer_variance row carries the same received
    // quantities as the paired transfer_received row — this is what the
    // EC-04 out-of-order projection trigger replays from
    // `pending_transfer_receipts` if this arrives before `transfer_dispatched`.
    line_items: parsedReceived,
    variance_items: z.array(TransferVarianceLineItemInputSchema).min(1).parse(varianceItems),
    actor_user_id: actorUserId,
  });

  return { hasVariance: true };
}

// Signed per-SKU delta = received − dispatched (negative = shortage, positive
// = surplus); SKUs with zero delta are omitted — a variance event must never
// be an inert no-op row.
function computeVariance(
  dispatched: TransferLineItemInput[],
  received: TransferLineItemInput[],
): TransferVarianceLineItemInput[] {
  const dispatchedBySku = new Map(dispatched.map((item) => [item.sku_id, item.qty]));
  const receivedBySku = new Map(received.map((item) => [item.sku_id, item.qty]));
  const skuIds = new Set([...dispatchedBySku.keys(), ...receivedBySku.keys()]);

  const variance: TransferVarianceLineItemInput[] = [];
  for (const skuId of skuIds) {
    const delta = (receivedBySku.get(skuId) ?? 0) - (dispatchedBySku.get(skuId) ?? 0);
    if (delta !== 0) variance.push({ sku_id: skuId, qty: delta });
  }
  return variance;
}
