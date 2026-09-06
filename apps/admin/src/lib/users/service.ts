import type { SupabaseClient } from "@supabase/supabase-js";

export type UserRole = "cashier" | "store_manager" | "hq_admin";

export type UserRow = {
  user_id: string;
  role: UserRole;
  store_id: string | null;
  full_name: string;
  pin_updated_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StoreOption = {
  store_id: string;
  code: string;
  name: string;
};

const USER_COLUMNS = "user_id, role, store_id, full_name, pin_updated_at, is_active, created_at, updated_at";

// `pin_hash` is deliberately never selected here — the admin UI has no
// legitimate use for it, and RLS-scoped SELECTs still shouldn't widen what
// a browser tab holds in memory (OWASP A01/A04: minimize sensitive data
// exposure even to authorized callers).
export async function listUsers(supabase: SupabaseClient): Promise<UserRow[]> {
  const { data, error } = await supabase.from("users").select(USER_COLUMNS).order("full_name", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load users: ${error.message}`);
  }
  const rows: UserRow[] = data ?? [];
  return rows;
}

export async function listStoreOptions(supabase: SupabaseClient): Promise<StoreOption[]> {
  const { data, error } = await supabase.from("stores").select("store_id, code, name").order("name", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load stores: ${error.message}`);
  }
  const rows: StoreOption[] = data ?? [];
  return rows;
}

// Argon2id hashing happens server-side (Edge Function `hash-cashier-pin`)
// since the admin app runs outside the Tauri shell and can't call the
// till's Rust `hash_pin` command (T041). See that function's header comment
// for why pgcrypto/deno.land's argon2 plugin were ruled out.
async function hashCashierPin(supabase: SupabaseClient, pin: string): Promise<string> {
  const response = await supabase.functions.invoke<{ hash: string }>("hash-cashier-pin", { body: { pin } });
  const data: { hash: string } | null = response.data;
  const invokeFailed: boolean = response.error !== null;
  if (invokeFailed || data === null || typeof data.hash !== "string") {
    const detail = invokeFailed ? errorMessage(response.error) : "empty response";
    throw new Error(`Failed to hash PIN: ${detail}`);
  }
  return data.hash;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export type CreateCashierInput = {
  fullName: string;
  storeId: string;
  pin: string;
};

// hq_admin only — enforced by `users_write_hq` RLS (0009), not re-checked
// here client-side.
export async function createCashier(supabase: SupabaseClient, input: CreateCashierInput): Promise<void> {
  const pinHash = await hashCashierPin(supabase, input.pin);
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("users").insert({
    user_id: crypto.randomUUID(),
    role: "cashier",
    store_id: input.storeId,
    full_name: input.fullName,
    pin_hash: pinHash,
    pin_updated_at: nowIso,
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (error !== null) {
    throw new Error(`Failed to create cashier: ${error.message}`);
  }
}

// hq_admin: any user. store_manager: only a cashier already in their own
// store — enforced by `users_write_hq` / `users_update_store_manager` RLS
// (0009/0015), not re-checked here client-side.
export async function setUserActive(supabase: SupabaseClient, userId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error !== null) {
    throw new Error(`Failed to update user status: ${error.message}`);
  }
}

export type UpdateCashierProfileInput = {
  fullName: string;
  storeId: string;
};

// hq_admin only — the store_manager RLS/trigger scope (0015) blocks
// full_name changes entirely.
export async function updateCashierProfile(
  supabase: SupabaseClient,
  userId: string,
  input: UpdateCashierProfileInput,
): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ full_name: input.fullName, store_id: input.storeId, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error !== null) {
    throw new Error(`Failed to update cashier: ${error.message}`);
  }
}

// hq_admin only — same RLS scope as updateCashierProfile.
export async function resetCashierPin(supabase: SupabaseClient, userId: string, pin: string): Promise<void> {
  const pinHash = await hashCashierPin(supabase, pin);
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("users")
    .update({ pin_hash: pinHash, pin_updated_at: nowIso, updated_at: nowIso })
    .eq("user_id", userId);

  if (error !== null) {
    throw new Error(`Failed to reset PIN: ${error.message}`);
  }
}
