/**
 * Event Schemas — Retail POS 001-retail-pos-mvp
 *
 * Zod schemas for every event type. Shared between apps/pos (client-side
 * validation before write) and supabase/functions (server-side validation
 * on ingest). Mirrors specs/001-retail-pos-mvp/contracts/events.schema.ts
 * verbatim (T014); drift between the two files is a spec bug.
 *
 * All events extend `BaseEventSchema`. See specs/001-retail-pos-mvp/data-model.md §2.
 */

import { z } from "zod";

// ---------- Common ----------

export const BaseEventSchema = z.object({
  event_id: z.string().uuid(),
  till_id: z.string().uuid(),
  store_id: z.string().uuid(),
  client_ts: z.string().datetime({ offset: true }),
  app_version: z.string().min(1),
  schema_ver: z.number().int().positive(),
});

export const MoneySchema = z.number().finite().nonnegative();
export const QtySchema = z.number().finite();
export const CurrencySchema = z.literal("ZMW");

// ---------- Sale ----------

export const SaleLineItemSchema = z.object({
  sku_id: z.string().uuid(),
  price_version_id: z.string().uuid(),
  unit_price: MoneySchema,
  qty: QtySchema.positive(),
  line_discount: MoneySchema.default(0),
  line_total: MoneySchema,
  promotion_id: z.string().uuid().nullable(),
  batch_no: z.string().nullable(),
  expiry_date: z.string().date().nullable(),
});

export const TenderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cash"),
    amount: MoneySchema.positive(),
    reference: z.null(),
  }),
  z.object({
    type: z.literal("card"),
    amount: MoneySchema.positive(),
    reference: z.string().min(1),
    card_masked_pan: z.string().regex(/^\*+\d{4}$/),
    card_reader_token: z.string().min(1),
  }),
  z.object({
    type: z.literal("mobile_money_mtn"),
    amount: MoneySchema.positive(),
    reference: z.string().min(1),
  }),
  z.object({
    type: z.literal("mobile_money_airtel"),
    amount: MoneySchema.positive(),
    reference: z.string().min(1),
  }),
]);

export const SaleEventSchema = BaseEventSchema.extend({
  kind: z.literal("sale"),
  sale_id: z.string().uuid(),
  cashier_id: z.string().uuid(),
  shift_id: z.string().uuid(),
  status: z.enum(["completed", "voided", "refunded"]),
  items: z.array(SaleLineItemSchema).min(1),
  tenders: z.array(TenderSchema).min(1),
  subtotal: MoneySchema,
  discount_total: MoneySchema.default(0),
  tax_total: MoneySchema.default(0),
  grand_total: MoneySchema,
  original_sale_id: z.string().uuid().nullable(),
  refund_kind: z
    .enum(["same_till_session_void", "same_till_history", "cross_till"])
    .nullable(),
}).refine(
  (s) =>
    s.status === "completed" ? s.original_sale_id === null : s.original_sale_id !== null,
  {
    message: "refund/void events must reference original_sale_id; completed sales must not",
  },
);

// ---------- Shift ----------

export const ShiftOpenPayloadSchema = z.object({
  opening_float: MoneySchema,
});

export const ShiftClosePayloadSchema = z.object({
  cash_counted: MoneySchema,
  tender_breakdown: z.record(z.string(), MoneySchema),
  notes: z.string().nullable(),
});

export const ShiftEventSchema = BaseEventSchema.extend({
  kind: z.literal("shift"),
  shift_id: z.string().uuid(),
  cashier_id: z.string().uuid(),
  event_kind: z.enum(["shift_open", "shift_close"]),
  payload: z.union([ShiftOpenPayloadSchema, ShiftClosePayloadSchema]),
});

// ---------- Stock (direct events — count_correction only from tills) ----------

export const StockEventSchema = BaseEventSchema.extend({
  kind: z.literal("stock"),
  sku_id: z.string().uuid(),
  event_type: z.enum([
    "sale",
    "refund",
    "transfer_out",
    "transfer_in",
    "transfer_variance",
    "adjustment",
    "count_correction",
  ]),
  delta_qty: QtySchema,
  source_ref_id: z.string().uuid().nullable(),
  batch_no: z.string().nullable(),
  expiry_date: z.string().date().nullable(),
  reason_code: z.string().nullable(),
  notes: z.string().nullable(),
}).refine(
  (e) =>
    e.event_type === "count_correction" || e.event_type === "adjustment"
      ? e.reason_code !== null
      : true,
  { message: "reason_code is required for count_correction and adjustment" },
);

// ---------- Transfer ----------

export const TransferLineItemSchema = z.object({
  sku_id: z.string().uuid(),
  qty: QtySchema.positive(),
});

export const TransferEventSchema = BaseEventSchema.extend({
  kind: z.literal("transfer"),
  transfer_id: z.string().uuid(),
  event_kind: z.enum([
    "transfer_requested",
    "transfer_dispatched",
    "transfer_received",
    "transfer_variance",
  ]),
  source_store_id: z.string().uuid(),
  destination_store_id: z.string().uuid(),
  line_items: z.array(TransferLineItemSchema).min(1),
  variance_items: z.array(TransferLineItemSchema).nullable(),
  actor_user_id: z.string().uuid(),
});

// ---------- Adjustment ----------

export const AdjustmentEventSchema = BaseEventSchema.extend({
  kind: z.literal("adjustment"),
  adjustment_id: z.string().uuid(),
  event_kind: z.enum(["adjustment_requested", "adjustment_approved", "adjustment_rejected"]),
  sku_id: z.string().uuid(),
  delta_qty: QtySchema,
  reason_code: z.string().min(1),
  requested_by_user_id: z.string().uuid(),
  approver_user_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
}).refine(
  (e) =>
    e.event_kind === "adjustment_requested"
      ? e.approver_user_id === null
      : e.approver_user_id !== null,
  {
    message: "approver_user_id is required on approve/reject and forbidden on request",
  },
);

// ---------- Price change ----------

export const PriceChangeEventSchema = BaseEventSchema.extend({
  kind: z.literal("price_change"),
  price_version_id: z.string().uuid(),
  sku_id: z.string().uuid(),
  price_scope_store_id: z.string().uuid().nullable(),
  old_unit_price: MoneySchema.nullable(),
  new_unit_price: MoneySchema,
  effective_from: z.string().datetime({ offset: true }),
  changed_by_user_id: z.string().uuid(),
  reason: z.string().nullable(),
});

// ---------- Sync-health snapshot ----------

export const SyncHealthSnapshotSchema = z.object({
  snapshot_id: z.string().uuid(),
  till_id: z.string().uuid(),
  store_id: z.string().uuid(),
  client_ts: z.string().datetime({ offset: true }),
  queue_depth: z.number().int().nonnegative(),
  oldest_pending_event_at: z.string().datetime({ offset: true }).nullable(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  consecutive_failures: z.number().int().nonnegative(),
  app_version: z.string().min(1),
  schema_version: z.number().int().positive(),
});

// ---------- Discriminated union of every till-writable event ----------

export const AnyTillEventSchema = z.discriminatedUnion("kind", [
  SaleEventSchema,
  ShiftEventSchema,
  StockEventSchema,
  TransferEventSchema,
  AdjustmentEventSchema,
]);

export type SaleEvent = z.infer<typeof SaleEventSchema>;
export type ShiftEvent = z.infer<typeof ShiftEventSchema>;
export type StockEvent = z.infer<typeof StockEventSchema>;
export type TransferEvent = z.infer<typeof TransferEventSchema>;
export type AdjustmentEvent = z.infer<typeof AdjustmentEventSchema>;
export type PriceChangeEvent = z.infer<typeof PriceChangeEventSchema>;
export type SyncHealthSnapshot = z.infer<typeof SyncHealthSnapshotSchema>;
export type AnyTillEvent = z.infer<typeof AnyTillEventSchema>;
