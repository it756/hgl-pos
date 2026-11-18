/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// Creates a staff login (store_manager / hq_admin): an auth.users account
// plus the matching public.users row (user_id = auth uid, which is how the
// access-token hook resolves POS claims — 0010). Needs the service role to
// create auth users, so authorization is checked first against the CALLER's
// JWT via `assert_caller_is_hq_admin` (0015), keeping the role policy in
// Postgres. Passwords and PIN hashes are never logged or echoed back.

type InviteStaffRequest = {
  email: string;
  password: string;
  full_name: string;
  role: "store_manager" | "hq_admin";
  store_id: string | null;
  pin_hash: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

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

  const payload = parseRequest(await readJson(request));
  if (payload instanceof Response) return payload;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined || serviceRoleKey === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authzError } = await callerClient.rpc("assert_caller_is_hq_admin");
  if (authzError !== null) {
    return json({ error: "forbidden", detail: authzError.message }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const created = await admin.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
  });
  if (created.error !== null || created.data.user === null) {
    const detail = created.error?.message ?? "no user returned";
    const status = /already|exists|registered/i.test(detail) ? 409 : 400;
    return json({ error: "auth_user_create_failed", detail }, status);
  }

  const userId = created.data.user.id;
  const nowIso = new Date().toISOString();
  const { error: insertError } = await admin.from("users").insert({
    user_id: userId,
    role: payload.role,
    store_id: payload.store_id,
    full_name: payload.full_name,
    pin_hash: payload.pin_hash,
    pin_updated_at: nowIso,
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError !== null) {
    // Roll back so a half-created login can't exist without POS claims.
    await admin.auth.admin.deleteUser(userId);
    return json({ error: "staff_row_insert_failed", detail: insertError.message }, 400);
  }

  return json({ user_id: userId });
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseRequest(value: unknown): InviteStaffRequest | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  const fullName = typeof value.full_name === "string" ? value.full_name.trim() : "";
  const role = value.role;
  const storeId = value.store_id ?? null;
  const pinHash = typeof value.pin_hash === "string" ? value.pin_hash : "";

  if (!EMAIL_PATTERN.test(email)) return json({ error: "invalid_field", field: "email" }, 400);
  if (password.length < MIN_PASSWORD_LENGTH) return json({ error: "invalid_field", field: "password" }, 400);
  if (fullName.length === 0) return json({ error: "invalid_field", field: "full_name" }, 400);
  if (role !== "store_manager" && role !== "hq_admin") return json({ error: "invalid_field", field: "role" }, 400);
  if (!pinHash.startsWith("$argon2id$")) return json({ error: "invalid_field", field: "pin_hash" }, 400);
  if (role === "hq_admin" && storeId !== null) return json({ error: "invalid_field", field: "store_id" }, 400);
  if (role === "store_manager" && (typeof storeId !== "string" || !UUID_PATTERN.test(storeId))) {
    return json({ error: "invalid_field", field: "store_id" }, 400);
  }

  return { email, password, full_name: fullName, role, store_id: storeId as string | null, pin_hash: pinHash };
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