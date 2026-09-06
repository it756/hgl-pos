/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type ProvisionTillRequest = {
  store_id: string;
  label: string;
  device_identity: string;
  operator_user_id: string;
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
  const payload = parseProvisionTillRequest(body);
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

  const { data, error } = await supabase.rpc("provision_till", {
    p_store_id: payload.store_id,
    p_label: payload.label,
    p_device_identity: payload.device_identity,
    p_operator_user_id: payload.operator_user_id,
  });

  if (error !== null) {
    return json({ error: "provision_failed", detail: error.message }, 403);
  }

  const provisioned = Array.isArray(data) ? data[0] : data;
  if (!isRecord(provisioned)) {
    return json({ error: "provision_response_invalid" }, 500);
  }

  return json({
    till_id: provisioned.till_id,
    credential: provisioned.credential,
    expires_at: provisioned.expires_at,
    initial_sync_ready: provisioned.initial_sync_ready === true,
  });
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseProvisionTillRequest(value: unknown): ProvisionTillRequest | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const payload = {
    store_id: readUuid(value, "store_id"),
    label: readNonEmptyString(value, "label"),
    device_identity: readNonEmptyString(value, "device_identity"),
    operator_user_id: readUuid(value, "operator_user_id"),
  };

  const invalidField = Object.entries(payload).find(([, fieldValue]) => fieldValue === "");
  if (invalidField !== undefined) {
    return json({ error: "invalid_field", field: invalidField[0] }, 400);
  }

  return payload;
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
