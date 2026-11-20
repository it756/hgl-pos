import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEMA_VERSION } from "@hgl/db-shared";
import { z } from "zod";
import { loadSkuOptions, loadStoreOptions, type SkuOption, type StoreOption } from "../catalog/options";

const ADMIN_APP_VERSION = "admin-web";

// Duplicated from prices/change.ts rather than imported: that module pulls
// in `node:crypto` (server-only) via its `randomUUID` import, and this file
// is also used by a "use client" component (adjustments-dashboard.tsx) —
// importing it here would drag `node:crypto` into the browser bundle.
const HQ_CONSOLE_TILL_ID = "00000000-0000-4000-8000-000000000000";

export type { SkuOption, StoreOption };

export type AdjustmentEventRow = {
  event_id: string;
  server_ts: string;
  adjustment_id: string;
  event_kind: "adjustment_requested" | "adjustment_approved" | "adjustment_rejected";
  store_id: string;
  sku_id: string;
  delta_qty: number;
  reason_code: string;
  requested_by_user_id: string;
  approver_user_id: string | null;
  notes: string | null;
};

export type PendingAdjustment = {
  adjustment_id: string;
  store_id: string;
  sku_id: string;
  delta_qty: number;
  reason_code: string;
  requested_by_user_id: string;
  notes: string | null;
  requested_at: string;
};

const ADJUSTMENT_COLUMNS =
  "event_id, server_ts, adjustment_id, event_kind, store_id, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id, notes";

// Adjustment requests are only resolved once (FR-017) — a request is
// "pending" if no approved/rejected row shares its adjustment_id yet. RLS
// already scopes rows to the caller's own store (or all stores for
// hq_admin), so no extra store filter is needed here.
export async function listPendingAdjustments(supabase: SupabaseClient): Promise<PendingAdjustment[]> {
  const { data, error } = await supabase
    .from("adjustment_events")
    .select(ADJUSTMENT_COLUMNS)
    .order("server_ts", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load adjustments: ${error.message}`);
  }

  const rows: AdjustmentEventRow[] = data ?? [];
  const resolvedIds = new Set(rows.filter((row) => row.event_kind !== "adjustment_requested").map((row) => row.adjustment_id));

  return rows
    .filter((row) => row.event_kind === "adjustment_requested" && !resolvedIds.has(row.adjustment_id))
    .map((row) => ({
      adjustment_id: row.adjustment_id,
      store_id: row.store_id,
      sku_id: row.sku_id,
      delta_qty: row.delta_qty,
      reason_code: row.reason_code,
      requested_by_user_id: row.requested_by_user_id,
      notes: row.notes,
      requested_at: row.server_ts,
    }));
}

// store_manager only (0009/0016 RLS) — a manager can resolve a request only
// for their own store; hq_admin cannot approve/reject (adjustments are a
// store-level operational decision, not an HQ one).
async function resolveAdjustment(
  supabase: SupabaseClient,
  request: PendingAdjustment,
  approverUserId: string,
  eventKind: "adjustment_approved" | "adjustment_rejected",
): Promise<void> {
  const { error } = await supabase.from("adjustment_events").insert({
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: request.store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    adjustment_id: request.adjustment_id,
    event_kind: eventKind,
    sku_id: request.sku_id,
    delta_qty: request.delta_qty,
    reason_code: request.reason_code,
    requested_by_user_id: request.requested_by_user_id,
    approver_user_id: approverUserId,
    notes: request.notes,
  });

  if (error !== null) {
    throw new Error(`Failed to ${eventKind === "adjustment_approved" ? "approve" : "reject"} adjustment: ${error.message}`);
  }
}

export async function approveAdjustment(supabase: SupabaseClient, request: PendingAdjustment, approverUserId: string): Promise<void> {
  await resolveAdjustment(supabase, request, approverUserId, "adjustment_approved");
}

export async function rejectAdjustment(supabase: SupabaseClient, request: PendingAdjustment, approverUserId: string): Promise<void> {
  await resolveAdjustment(supabase, request, approverUserId, "adjustment_rejected");
}

export async function loadAdjustmentCatalog(supabase: SupabaseClient): Promise<{ skus: SkuOption[]; stores: StoreOption[] }> {
  const [skus, stores] = await Promise.all([loadSkuOptions(supabase), loadStoreOptions(supabase)]);
  return { skus, stores };
}

export const REASON_CODES = [
  { code: "damaged", label: "Damaged" },
  { code: "expired", label: "Expired" },
  { code: "theft", label: "Theft / loss" },
  { code: "found", label: "Found stock" },
  { code: "data_entry_error", label: "Data entry error" },
  { code: "supplier_return", label: "Returned to supplier" },
  { code: "other", label: "Other (explain in notes)" },
] as const;

export const NewAdjustmentSchema = z
  .object({
    sku_id: z.string().uuid("Choose a SKU"),
    delta_qty: z
      .number({ invalid_type_error: "Enter a quantity" })
      .finite()
      .refine((value) => value !== 0, "Quantity can't be zero"),
    reason_code: z.enum(REASON_CODES.map((reason) => reason.code) as [string, ...string[]], {
      errorMap: () => ({ message: "Choose a reason" }),
    }),
    notes: z.string().trim().max(500).nullable(),
  })
  .refine((value) => value.reason_code !== "other" || (value.notes !== null && value.notes.length > 0), {
    message: "Notes are required when the reason is Other",
    path: ["notes"],
  });
export type NewAdjustmentInput = z.infer<typeof NewAdjustmentSchema>;

// FR-017: small corrections are applied immediately; larger ones wait for a
// second look from a manager.
export function requiresApproval(deltaQty: number, thresholdQty: number): boolean {
  return Math.abs(deltaQty) > thresholdQty;
}

export function buildAdjustmentEvent(
  input: NewAdjustmentInput & { store_id: string; adjustment_id: string; requested_by_user_id: string },
  eventKind: AdjustmentEventRow["event_kind"],
  approverUserId: string | null,
) {
  return {
    event_id: crypto.randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: input.store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    adjustment_id: input.adjustment_id,
    event_kind: eventKind,
    sku_id: input.sku_id,
    delta_qty: input.delta_qty,
    reason_code: input.reason_code,
    requested_by_user_id: input.requested_by_user_id,
    approver_user_id: approverUserId,
    notes: input.notes,
  };
}

export type AdjustmentHistoryRow = {
  adjustment_id: string;
  store_id: string;
  sku_id: string;
  delta_qty: number;
  reason_code: string;
  notes: string | null;
  requested_by_user_id: string;
  requested_at: string;
  outcome: "pending" | "approved" | "rejected";
  approver_user_id: string | null;
  resolved_at: string | null;
};

export function foldAdjustmentHistory(rows: readonly AdjustmentEventRow[]): AdjustmentHistoryRow[] {
  const byId = new Map<string, AdjustmentHistoryRow>();
  for (const row of rows) {
    if (row.event_kind !== "adjustment_requested") continue;
    byId.set(row.adjustment_id, {
      adjustment_id: row.adjustment_id,
      store_id: row.store_id,
      sku_id: row.sku_id,
      delta_qty: Number(row.delta_qty),
      reason_code: row.reason_code,
      notes: row.notes,
      requested_by_user_id: row.requested_by_user_id,
      requested_at: row.server_ts,
      outcome: "pending",
      approver_user_id: null,
      resolved_at: null,
    });
  }
  for (const row of rows) {
    const entry = byId.get(row.adjustment_id);
    if (entry === undefined || row.event_kind === "adjustment_requested" || entry.outcome !== "pending") continue;
    entry.outcome = row.event_kind === "adjustment_approved" ? "approved" : "rejected";
    entry.approver_user_id = row.approver_user_id;
    entry.resolved_at = row.server_ts;
  }
  return [...byId.values()].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

export async function listAdjustmentHistory(supabase: SupabaseClient, limit = 500): Promise<AdjustmentHistoryRow[]> {
  const { data, error } = await supabase
    .from("adjustment_events")
    .select(ADJUSTMENT_COLUMNS)
    .order("server_ts", { ascending: false })
    .limit(limit * 2);
  if (error !== null) throw new Error(`Failed to load adjustment history: ${error.message}`);
  return foldAdjustmentHistory((data ?? [])).slice(0, limit);
}