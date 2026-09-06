/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SyncHealthSnapshot = {
  snapshot_id: string;
  till_id: string;
  store_id: string;
  client_ts: string;
  queue_depth: number;
  oldest_pending_event_at: string | null;
  last_successful_sync_at: string | null;
  consecutive_failures: number;
  app_version: string;
  schema_version: number;
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
  const snapshot = parseSnapshot(body);
  if (snapshot instanceof Response) return snapshot;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("sync_health_snapshots").upsert(snapshot, {
    onConflict: "snapshot_id",
    ignoreDuplicates: true,
  });

  if (error !== null) {
    return json({ error: "insert_failed", detail: error.message }, 403);
  }

  return json({ accepted: true }, 202);
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseSnapshot(value: unknown): SyncHealthSnapshot | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const snapshot: SyncHealthSnapshot = {
    snapshot_id: readUuid(value, "snapshot_id"),
    till_id: readUuid(value, "till_id"),
    store_id: readUuid(value, "store_id"),
    client_ts: readIsoDate(value, "client_ts"),
    queue_depth: readNonNegativeInteger(value, "queue_depth"),
    oldest_pending_event_at: readNullableIsoDate(value, "oldest_pending_event_at"),
    last_successful_sync_at: readNullableIsoDate(value, "last_successful_sync_at"),
    consecutive_failures: readNonNegativeInteger(value, "consecutive_failures"),
    app_version: readNonEmptyString(value, "app_version"),
    schema_version: readPositiveInteger(value, "schema_version"),
  };

  const invalidField = [
    ["snapshot_id", snapshot.snapshot_id === ""],
    ["till_id", snapshot.till_id === ""],
    ["store_id", snapshot.store_id === ""],
    ["client_ts", snapshot.client_ts === ""],
    ["queue_depth", snapshot.queue_depth < 0],
    ["oldest_pending_event_at", snapshot.oldest_pending_event_at === ""],
    ["last_successful_sync_at", snapshot.last_successful_sync_at === ""],
    ["consecutive_failures", snapshot.consecutive_failures < 0],
    ["app_version", snapshot.app_version === ""],
    ["schema_version", snapshot.schema_version < 1],
  ].find(([, isInvalid]) => isInvalid);
  if (invalidField !== undefined) {
    return json({ error: "invalid_field", field: invalidField[0] }, 400);
  }

  return snapshot;
}

function readUuid(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key];
  if (typeof fieldValue !== "string") return "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fieldValue)
    ? fieldValue
    : "";
}

function readIsoDate(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key];
  if (typeof fieldValue !== "string") return "";
  return Number.isNaN(new Date(fieldValue).getTime()) ? "" : fieldValue;
}

function readNullableIsoDate(value: Record<string, unknown>, key: string): string | null {
  if (value[key] === null) return null;
  return readIsoDate(value, key);
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string {
  const fieldValue = value[key];
  return typeof fieldValue === "string" && fieldValue.length > 0 ? fieldValue : "";
}

function readNonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const fieldValue = value[key];
  return Number.isInteger(fieldValue) && fieldValue >= 0 ? fieldValue : -1;
}

function readPositiveInteger(value: Record<string, unknown>, key: string): number {
  const fieldValue = value[key];
  return Number.isInteger(fieldValue) && fieldValue > 0 ? fieldValue : -1;
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
