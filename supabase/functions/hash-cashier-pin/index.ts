/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { argon2id } from "npm:hash-wasm@4.12.0";

// Cashier PINs are verified at the till via Argon2id (apps/pos/src-tauri/src/pin.rs,
// T041). The admin app runs outside Tauri and can't call that Rust command, so this
// function produces an equivalent Argon2id PHC-format hash using a pure-WASM
// implementation (no native/FFI plugin — unlike deno.land/x/argon2, which Supabase's
// hosted Edge Runtime can't load). PHC strings are self-describing, so exact param
// parity with pin.rs isn't required for the till's `verify_pin` to accept the result.
// Postgres pgcrypto was ruled out: it only supports bcrypt/md5/DES, not Argon2.
//
// Authorization is delegated to Postgres (`assert_caller_is_hq_admin`, 0015) rather
// than decoded here, so the RLS/role policy stays in one place.

const MEMORY_SIZE_KIB = 19_456;
const ITERATIONS = 3;
const PARALLELISM = 1;
const HASH_LENGTH_BYTES = 32;
const PIN_PATTERN = /^\d{4,8}$/;

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
  const pin = parsePin(body);
  if (pin instanceof Response) return pin;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: authzError } = await supabase.rpc("assert_caller_is_hq_admin");
  if (authzError !== null) {
    return json({ error: "forbidden", detail: authzError.message }, 403);
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const hash = await argon2id({
    password: pin,
    salt,
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_SIZE_KIB,
    hashLength: HASH_LENGTH_BYTES,
    outputType: "encoded",
  });

  return json({ hash });
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parsePin(value: unknown): string | Response {
  if (!isRecord(value) || typeof value.pin !== "string" || !PIN_PATTERN.test(value.pin)) {
    return json({ error: "invalid_pin", detail: "pin must be 4-8 digits" }, 400);
  }
  return value.pin;
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
