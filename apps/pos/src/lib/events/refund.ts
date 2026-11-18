import { SaleEventSchema, SaleLineItemSchema, TenderSchema, type SaleEvent } from "@hgl/events";
import { z } from "zod";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "../sync/engine";
import type { ReliableClock } from "../time/clock";
import { nextEventId } from "./id";
import {
  applyCashTenderToShiftSystemCash,
  applyLocalStockDeduction,
  ensureSaleTables,
  persistSaleEvent,
  persistSaleProjection,
} from "./sale";

// Cross-till / cross-day refund flow (T108, FR-012, User Story 5). Unlike
// void.ts's same-till-session void, this is the one deliberately
// non-offline-capable flow in the system: the original sale must be
// confirmed server-side (`POST /verify-refund`, T107) before any local
// write happens. `verifyRefundEligibility()`/`signInForRefundVerification()`
// below throw a `RefundConnectivityError` on any network failure — callers
// (the refund page) must surface that as an explicit "connectivity
// required" message and must NOT fall back to a local write.

export class RefundConnectivityError extends Error {}

const VerifyRefundOriginalSchema = z.object({
  sale_id: z.string().uuid(),
  till_id: z.string().uuid(),
  store_id: z.string().uuid(),
  cashier_id: z.string().uuid(),
  shift_id: z.string().uuid(),
  items: z.array(SaleLineItemSchema).min(1),
  tenders: z.array(TenderSchema).min(1),
  subtotal: z.number(),
  discount_total: z.number(),
  tax_total: z.number(),
  grand_total: z.number(),
  server_ts: z.string(),
  already_refunded: z.boolean(),
});

const VerifyRefundResponseSchema = z.discriminatedUnion("eligible", [
  z.object({
    eligible: z.literal(true),
    refund_token: z.string().uuid(),
    original: VerifyRefundOriginalSchema,
  }),
  z.object({
    eligible: z.literal(false),
    reason: z.enum(["already_refunded", "sale_not_found", "outside_refund_window"]),
  }),
]);

export type VerifyRefundResponse = z.infer<typeof VerifyRefundResponseSchema>;
export type VerifyRefundEligibleResponse = Extract<VerifyRefundResponse, { eligible: true }>;

export type VerifyRefundEligibilityParams = {
  endpoint: string;
  accessToken: string;
  originalSaleId: string;
  refundReason: string;
  fetchImpl?: typeof fetch;
};

export async function verifyRefundEligibility(params: VerifyRefundEligibilityParams): Promise<VerifyRefundResponse> {
  // Native fetch throws "Illegal invocation" unless bound to a Window-like receiver.
  const fetchImpl = (params.fetchImpl ?? fetch).bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(params.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ original_sale_id: params.originalSaleId, refund_reason: params.refundReason }),
    });
  } catch (error) {
    throw new RefundConnectivityError(
      "Could not reach the refund verification service — connectivity is required for a cross-till or historical refund.",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new RefundConnectivityError(`Refund verification failed (HTTP ${response.status}).`);
  }

  const body: unknown = await response.json();
  const parsed = VerifyRefundResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new RefundConnectivityError("Refund verification returned an unexpected response.");
  }

  return parsed.data;
}

export type SignInForRefundVerificationParams = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
};

/**
 * Step-up online authentication for the connectivity-required refund flow.
 * Cashier till login (auth/cashier-session.ts) is entirely offline/PIN-based
 * against a locally cached roster, so there is no Supabase Auth session
 * available client-side to call verify-refund with. This exchanges the
 * cashier's/manager's real Supabase Auth credentials (seeded 1:1 with every
 * `users` row) for an access token scoped by `access_token_hook` (0010),
 * purpose-built for this one online-only action — not a general-purpose
 * sign-in path for the rest of the till app.
 */
export async function signInForRefundVerification(params: SignInForRefundVerificationParams): Promise<string> {
  // Native fetch throws "Illegal invocation" unless bound to a Window-like receiver.
  const fetchImpl = (params.fetchImpl ?? fetch).bind(globalThis);

  let response: Response;
  try {
    response = await fetchImpl(`${params.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: params.supabaseAnonKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: params.email, password: params.password }),
    });
  } catch (error) {
    throw new RefundConnectivityError(
      "Could not reach the sign-in service — connectivity is required for a cross-till or historical refund.",
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new RefundConnectivityError("Sign-in failed — check the email and password and try again.");
  }

  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.access_token !== "string") {
    throw new RefundConnectivityError("Sign-in response did not include an access token.");
  }

  return body.access_token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ---------- Persistence ----------

export type RefundEventQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  clock: ReliableClock;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export type RefundSaleParams = {
  cashierId: string;
  /** This till's CURRENT open shift — the refund belongs to the till/shift issuing it, not the original sale's shift. */
  shiftId: string;
  refundReason: string;
  refundToken: string;
  original: VerifyRefundEligibleResponse["original"];
};

export class RefundEventQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #clock: ReliableClock;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: RefundEventQueueOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#clock = options.clock;
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureSaleTables(this.#db);
    await ensureRefundVerificationTable(this.#db);
  }

  /** Must only be called with an `original` payload returned by an `eligible: true` verify-refund response. */
  async refundSale(params: RefundSaleParams): Promise<SaleEvent> {
    await this.init();
    await this.#clock.assertFinancialClockAllowed();

    const clientTs = (await this.#clock.trustedNow()).toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);
    const refundKind = params.original.till_id === this.#tillId ? "same_till_history" : "cross_till";

    const refundEvent = SaleEventSchema.parse({
      event_id: eventId,
      till_id: this.#tillId,
      store_id: this.#storeId,
      client_ts: clientTs,
      app_version: this.#appVersion,
      schema_ver: localSchemaVersion,
      kind: "sale",
      sale_id: eventId, // its own identity — original_sale_id carries the link back
      cashier_id: params.cashierId,
      shift_id: params.shiftId,
      status: "refunded",
      items: params.original.items,
      tenders: params.original.tenders,
      subtotal: params.original.subtotal,
      discount_total: params.original.discount_total,
      tax_total: params.original.tax_total,
      grand_total: params.original.grand_total,
      original_sale_id: params.original.sale_id,
      refund_kind: refundKind,
    });

    await persistSaleEvent(this.#db, refundEvent);
    await persistSaleProjection(this.#db, refundEvent);
    await applyLocalStockDeduction(this.#db, refundEvent);
    await applyCashTenderToShiftSystemCash(this.#db, refundEvent);

    await this.#db.insert(
      `INSERT INTO local_refund_verifications (
        refund_event_id, original_sale_id, refund_token, refund_reason, refund_kind, verified_by_user_id, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(refund_event_id) DO NOTHING`,
      [eventId, params.original.sale_id, params.refundToken, params.refundReason, refundKind, params.cashierId, clientTs],
    );

    await this.#syncEngine.enqueue(refundEvent);
    return refundEvent;
  }
}

/**
 * Till-local-only audit trail of verified refunds (never synced — mirrors
 * cart/parked.ts's till-local-only convention). `sale_events`/`SaleEvent`
 * has no generic JSONB payload column (unlike shift_events), so the
 * refund_token/reason can't be embedded in the synced event itself; the
 * durable, tamper-evident audit record is the `audit_log` row written
 * server-side by `verify_refund_eligibility` (migration 0017) at
 * verification time. This local table exists only so a manager reviewing
 * this specific till can see which verification produced which refund.
 */
export async function ensureRefundVerificationTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_refund_verifications (
      refund_event_id TEXT PRIMARY KEY,
      original_sale_id TEXT NOT NULL,
      refund_token TEXT NOT NULL,
      refund_reason TEXT NOT NULL,
      refund_kind TEXT NOT NULL CHECK (refund_kind IN ('same_till_history', 'cross_till')),
      verified_by_user_id TEXT NOT NULL,
      verified_at TEXT NOT NULL
    )`,
  );
}
