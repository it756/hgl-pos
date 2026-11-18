/// <reference path="../deno.d.ts" />

// Bootstraps a till's very first Supabase-shaped JWT from its existing opaque
// device credential (see supabase/migrations/0021_device_session_rpc.sql).
// Deliberately does NOT create a real auth.users row or go through GoTrue —
// PowerSync's client_auth (service.yaml) and this project's own RLS helper
// functions (claim_role()/claim_store_id()/claim_till_id() in
// 0009_rls_policies.sql) only ever inspect JWT claims directly, so a
// correctly-shaped, correctly-signed token works identically either way.
// See repo memory / spike-report.md follow-up notes for the design rationale.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

type MintDeviceJwtRequest = {
  till_id: string;
  credential: string;
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
  const payload = parseMintDeviceJwtRequest(body);
  if (payload instanceof Response) return payload;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  // NOT named SUPABASE_JWT_SECRET: the Edge Runtime rejects any custom secret
  // with that reserved prefix ("Env name cannot start with SUPABASE_"). Value
  // must still equal the project's real JWT signing secret (`supabase status`).
  const jwtSecret = Deno.env.get("DEVICE_JWT_SIGNING_SECRET");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined || jwtSecret === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("verify_device_credential", {
    p_till_id: payload.till_id,
    p_credential: payload.credential,
  });

  if (error !== null) {
    return json({ error: "credential_invalid", detail: error.message }, 403);
  }

  const verified = Array.isArray(data) ? data[0] : data;
  if (!isRecord(verified) || typeof verified.store_id !== "string") {
    return json({ error: "verification_response_invalid" }, 500);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = nowSeconds + ACCESS_TOKEN_TTL_SECONDS;

  // Mirrors public.access_token_hook's device-role derived claims exactly
  // (powersync/sync-config.yaml's streams read auth.parameter('*_store_id'/
  // '*_till_id'), not the plain store_id/till_id claims) — a device gets its
  // store's catalog/prices/stock (so it can sync fully offline-first without
  // waiting on a cashier login) plus its own roster refresh
  // (store_users_store_id) and provisioning lookup, but never
  // till-activity/store-operations/sync-health — those stay cashier/
  // store_manager-only.
  const accessToken = await signDeviceJwt(jwtSecret, {
    aud: "authenticated",
    role: "authenticated",
    sub: payload.till_id,
    pos_role: "device",
    store_id: verified.store_id,
    till_id: payload.till_id,
    // No separate device-identity concept exists yet (see repo scope-out notes)
    // — the till's own id doubles as its device id, matching the fallback the
    // access-token hook itself already uses for real GoTrue-issued tokens.
    device_id: payload.till_id,
    store_catalog_store_id: verified.store_id,
    store_prices_store_id: verified.store_id,
    store_stock_store_id: verified.store_id,
    store_users_store_id: verified.store_id,
    till_activity_till_id: null,
    store_operations_store_id: null,
    sync_health_store_id: null,
    device_provisioning_till_id: payload.till_id,
    iat: nowSeconds,
    exp: expiresAtSeconds,
  });

  return json({
    access_token: accessToken,
    expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
  });
});

async function signDeviceJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseMintDeviceJwtRequest(value: unknown): MintDeviceJwtRequest | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const payload = {
    till_id: readUuid(value, "till_id"),
    credential: readNonEmptyString(value, "credential"),
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
