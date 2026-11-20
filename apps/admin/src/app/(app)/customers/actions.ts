"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { CustomerInputSchema, TierInputSchema } from "../../../lib/customers/service";
import { friendlyDbError, readField, readNumberOrNull, readOptional, type ActionState } from "../../../lib/format";

export async function saveCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin", "store_manager"]);
  const customerId = readOptional(formData, "customer_id");
  const parsed = CustomerInputSchema.safeParse({
    full_name: readField(formData, "full_name"),
    phone: readField(formData, "phone"),
    email: readField(formData, "email"),
    loyalty_tier_id: readOptional(formData, "loyalty_tier_id"),
    credit_limit: readNumberOrNull(formData, "credit_limit"),
    home_store_id: readOptional(formData, "home_store_id"),
    notes: readField(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid customer.", success: false };

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } =
    customerId === null
      ? await supabase.from("customers").insert({ ...parsed.data, created_at: nowIso, updated_at: nowIso })
      : await supabase.from("customers").update({ ...parsed.data, updated_at: nowIso }).eq("customer_id", customerId);
  if (error !== null) return { error: friendlyDbError(error, "A customer with this phone number"), success: false };
  revalidatePath("/customers");
  return { error: null, success: true };
}

export async function setCustomerActive(customerId: string, isActive: boolean): Promise<{ error: string | null }> {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("customers").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("customer_id", customerId);
  if (error !== null) return { error: friendlyDbError(error, "Customer") };
  revalidatePath("/customers");
  return { error: null };
}

export async function saveTier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin"]);
  const tierId = readOptional(formData, "tier_id");
  const parsed = TierInputSchema.safeParse({
    code: readField(formData, "code"),
    name: readField(formData, "name"),
    rank: Number(readField(formData, "rank") || "0"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid tier.", success: false };

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } =
    tierId === null
      ? await supabase.from("loyalty_tiers").insert({ ...parsed.data, created_at: nowIso, updated_at: nowIso })
      : await supabase.from("loyalty_tiers").update({ ...parsed.data, updated_at: nowIso }).eq("tier_id", tierId);
  if (error !== null) return { error: friendlyDbError(error, "A tier with this code"), success: false };
  revalidatePath("/customers");
  revalidatePath("/promotions");
  return { error: null, success: true };
}

export async function setTierActive(tierId: string, isActive: boolean): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("loyalty_tiers").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("tier_id", tierId);
  if (error !== null) return { error: friendlyDbError(error, "Tier") };
  revalidatePath("/customers");
  revalidatePath("/promotions");
  return { error: null };
}
