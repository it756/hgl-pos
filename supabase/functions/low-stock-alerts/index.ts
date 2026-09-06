/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Low-stock alert generator (T095, FR-018). Mirrors sync-health-alerts:
// service-role gated, calls a Postgres function for the candidate query,
// posts a digest to a webhook if configured. No dedicated alerts table
// (unlike sync_health_alerts) — FR-018 only asks for a notification, not
// open/closed alert state tracking.

type LowStockCandidate = {
  store_id: string;
  sku_id: string;
  qty_on_hand: number;
  reorder_point: number;
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

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (serviceRoleKey === undefined || authorization !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("low_stock_alert_candidates");
  if (error !== null) {
    return json({ error: "low_stock_check_failed", detail: error.message }, 500);
  }

  const candidates: LowStockCandidate[] = Array.isArray(data) ? data : [];
  const webhookUrl = Deno.env.get("LOW_STOCK_ALERT_WEBHOOK_URL");
  const postedCount = webhookUrl === undefined ? 0 : await postCandidates(webhookUrl, candidates);

  return json({ candidate_count: candidates.length, posted_count: postedCount });
});

async function postCandidates(webhookUrl: string, candidates: readonly LowStockCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "low_stock_alerts", candidates }),
  });

  if (!response.ok) {
    throw new Error(`low stock alert webhook failed with HTTP ${response.status}`);
  }

  return candidates.length;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
