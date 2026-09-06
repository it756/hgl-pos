/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SyncHealthAlert = {
  alert_id: string;
  till_id: string;
  store_id: string;
  opened_at: string;
  reason: "stale_sync" | "queue_backlog" | "repeated_failures";
  payload: Record<string, unknown> | null;
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

  const { data: insertedCount, error: checkError } = await supabase.rpc("check_sync_health_and_alert");
  if (checkError !== null) {
    return json({ error: "sync_health_check_failed", detail: checkError.message }, 500);
  }

  const { data: alerts, error: alertError } = await supabase
    .from("sync_health_alerts")
    .select("alert_id, till_id, store_id, opened_at, reason, payload")
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(100);

  if (alertError !== null) {
    return json({ error: "alert_read_failed", detail: alertError.message }, 500);
  }

  const webhookUrl = Deno.env.get("SYNC_HEALTH_ALERT_WEBHOOK_URL");
  const postedCount = webhookUrl === undefined ? 0 : await postAlerts(webhookUrl, alerts ?? []);

  return json({ checked: true, inserted_count: insertedCount ?? 0, open_alert_count: alerts?.length ?? 0, posted_count: postedCount });
});

async function postAlerts(webhookUrl: string, alerts: readonly SyncHealthAlert[]): Promise<number> {
  if (alerts.length === 0) return 0;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "sync_health_alerts", alerts }),
  });

  if (!response.ok) {
    throw new Error(`sync health alert webhook failed with HTTP ${response.status}`);
  }

  return alerts.length;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
