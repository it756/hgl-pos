/**
 * HTTP API contracts — Retail POS 001-retail-pos-mvp
 *
 * TS + Zod definitions for the small set of Edge Function HTTP endpoints
 * (see specs/001-retail-pos-mvp/contracts/http-api.md). Everything else in
 * this system goes through PowerSync's sync protocol.
 */

import { z } from "zod";

// ---------- Auth: device credential rotation ----------

export const RotateDeviceCredentialRequest = z.object({
  till_id: z.string().uuid(),
  current_credential: z.string().min(1),
});
export type RotateDeviceCredentialRequest = z.infer<typeof RotateDeviceCredentialRequest>;

export const RotateDeviceCredentialResponse = z.object({
  credential: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
});
export type RotateDeviceCredentialResponse = z.infer<typeof RotateDeviceCredentialResponse>;

// ---------- Till provisioning ----------

export const ProvisionTillRequest = z.object({
  store_id: z.string().uuid(),
  label: z.string().min(1).max(64),
  // Windows device identity — SMBIOS UUID (preferred) or a stable derivation
  // of hardware serial + Intune-assigned device ID.
  device_identity: z.string().min(1),
  operator_user_id: z.string().uuid(),
});
export type ProvisionTillRequest = z.infer<typeof ProvisionTillRequest>;

export const ProvisionTillResponse = z.object({
  till_id: z.string().uuid(),
  credential: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
  initial_sync_ready: z.literal(true),
});
export type ProvisionTillResponse = z.infer<typeof ProvisionTillResponse>;

// ---------- Cross-till refund verification ----------

export const VerifyRefundRequest = z.object({
  original_sale_id: z.string().uuid(),
  refund_reason: z.string().min(1).max(500),
});
export type VerifyRefundRequest = z.infer<typeof VerifyRefundRequest>;

export const VerifyRefundOriginal = z.object({
  sale_id: z.string().uuid(),
  till_id: z.string().uuid(),
  store_id: z.string().uuid(),
  grand_total: z.number().nonnegative(),
  server_ts: z.string().datetime({ offset: true }),
  already_refunded: z.boolean(),
});

export const VerifyRefundResponse = z.discriminatedUnion("eligible", [
  z.object({
    eligible: z.literal(true),
    refund_token: z.string().min(1),
    original: VerifyRefundOriginal,
  }),
  z.object({
    eligible: z.literal(false),
    reason: z.enum(["already_refunded", "sale_not_found", "outside_refund_window"]),
  }),
]);
export type VerifyRefundResponse = z.infer<typeof VerifyRefundResponse>;

// ---------- Sync-health snapshot (internal, called from tills) ----------

export const InternalSyncHealthSnapshotRequest = z.object({
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
export type InternalSyncHealthSnapshotRequest = z.infer<typeof InternalSyncHealthSnapshotRequest>;

export const InternalSyncHealthSnapshotResponse = z.object({
  received: z.literal(true),
});
export type InternalSyncHealthSnapshotResponse = z.infer<typeof InternalSyncHealthSnapshotResponse>;

// ---------- Report export ----------

export const ReportKind = z.enum([
  "sales_by_store",
  "sales_by_cashier",
  "sales_by_sku",
  "inventory_on_hand",
  "transfer_history",
  "till_reconciliation",
]);
export type ReportKind = z.infer<typeof ReportKind>;

export const ReportFormat = z.enum(["csv", "pdf"]);
export type ReportFormat = z.infer<typeof ReportFormat>;

export const ReportExportRequest = z.object({
  report: ReportKind,
  params: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    store_id: z.string().uuid().optional(),
  }),
  format: ReportFormat,
});
export type ReportExportRequest = z.infer<typeof ReportExportRequest>;

export const ReportExportResponse = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["queued", "running", "done", "failed"]),
  poll_url: z.string().url().optional(),
});
export type ReportExportResponse = z.infer<typeof ReportExportResponse>;

// ---------- Common error shape ----------

export const ApiError = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
