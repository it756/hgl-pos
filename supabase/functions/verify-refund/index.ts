/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// POST /verify-refund (T107, FR-012 / User Story 5). Server-side confirmation
// that a cross-till/cross-day refund's original sale exists, is not already
// refunded, and belongs to the caller's own store — required before the
// till may write the linked `refunded` sale_events row. See
// specs/001-retail-pos-mvp/contracts/http-api.md §"POST /verify-refund".
//
// Authorization mirrors provision-till/hash-cashier-pin: the caller's JWT is
// forwarded into a Supabase client built with the anon key, and the actual
// eligibility decision is made in Postgres (`verify_refund_eligibility`,
// migration 0017) — never in Deno.

type VerifyRefundRequest = {
  original_sale_id: string;
  refund_reason: string;
};

type VerifyRefundRow = {
  eligible: boolean;
  reason: string | null;
  refund_token: string | null;
  sale_id: string | null;
  till_id: string | null;
  store_id: string | null;
  cashier_id: string | null;
  shift_id: string | null;
  items: unknown;
  tenders: unknown;
  subtotal: number | null;
  discount_total: number | null;
  tax_total: number | null;
  grand_total: number | null;
  server_ts: string | null;
  already_refunded: boolean | null;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.toLowerCase().startsWith("bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const body = await readJson(request);
  const payload = parseVerifyRefundRequest(body);
  if (payload instanceof Response) return payload;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("verify_refund_eligibility", {
    p_original_sale_id: payload.original_sale_id,
    p_refund_reason: payload.refund_reason,
  });

  if (error !== null) {
    return json({ error: "verify_refund_failed", detail: error.message }, 403);
  }

  const row = (Array.isArray(data) ? data[0] : data) as VerifyRefundRow | undefined;
  if (row === undefined) {
    return json({ error: "verify_refund_response_invalid" }, 500);
  }

  if (!row.eligible) {
    return json({ eligible: false, reason: row.reason ?? "sale_not_found" });
  }

  return json({
    eligible: true,
    refund_token: row.refund_token,
    original: {
      sale_id: row.sale_id,
      till_id: row.till_id,
      store_id: row.store_id,
      cashier_id: row.cashier_id,
      shift_id: row.shift_id,
      items: row.items,
      tenders: row.tenders,
      subtotal: row.subtotal,
      discount_total: row.discount_total,
      tax_total: row.tax_total,
      grand_total: row.grand_total,
      server_ts: row.server_ts,
      already_refunded: row.already_refunded ?? false,
    },
  });
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseVerifyRefundRequest(value: unknown): VerifyRefundRequest | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const originalSaleId = readUuid(value, "original_sale_id");
  const refundReason = readNonEmptyString(value, "refund_reason");

  if (originalSaleId === "") {
    return json({ error: "invalid_field", field: "original_sale_id" }, 400);
  }
  if (refundReason === "") {
    return json({ error: "invalid_field", field: "refund_reason" }, 400);
  }

  return { original_sale_id: originalSaleId, refund_reason: refundReason };
}

function readUuid(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key];
  if (typeof fieldValue !== "string") return "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fieldValue)
    ? fieldValue
    : "";
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key];
  return typeof fieldValue === "string" && fieldValue.trim().length > 0 ? fieldValue.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
