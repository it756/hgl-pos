/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type RotateDeviceCredentialRequest = {
  till_id: string;
  current_credential: string;
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
  const payload = parseRotateDeviceCredentialRequest(body);
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

  const { data, error } = await supabase.rpc("rotate_device_credential", {
    p_till_id: payload.till_id,
    p_current_credential: payload.current_credential,
  });

  if (error !== null) {
    return json({ error: "rotation_failed", detail: error.message }, 403);
  }

  const rotated = Array.isArray(data) ? data[0] : data;
  if (!isRecord(rotated)) {
    return json({ error: "rotation_response_invalid" }, 500);
  }

  return json({ credential: rotated.credential, expires_at: rotated.expires_at });
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseRotateDeviceCredentialRequest(value: unknown): RotateDeviceCredentialRequest | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const payload = {
    till_id: readUuid(value, "till_id"),
    current_credential: readNonEmptyString(value, "current_credential"),
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
  return typeof fieldValue === "string" && fieldValue.length > 0 ? fieldValue : "";
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
