"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../lib/auth/session";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { submitPriceChange, PriceChangeInputSchema } from "../../lib/prices/change";

export type PriceChangeFormState = { error: string | null; success: boolean };

export async function createPriceChange(
  _prevState: PriceChangeFormState,
  formData: FormData,
): Promise<PriceChangeFormState> {
  const claims = await requireRole(["hq_admin"]);

  const storeIdInput = readField(formData, "store_id");
  const reasonInput = readField(formData, "reason");
  const effectiveFromInput = readField(formData, "effective_from");

  const parsed = PriceChangeInputSchema.safeParse({
    sku_id: readField(formData, "sku_id"),
    store_id: storeIdInput === "" ? null : storeIdInput,
    new_unit_price: Number(readField(formData, "new_unit_price")),
    effective_from: effectiveFromInput === "" ? new Date().toISOString() : toIsoDateTime(effectiveFromInput),
    reason: reasonInput === "" ? null : reasonInput,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid price change.", success: false };
  }

  try {
    const supabase = await createSupabaseServerClient();
    await submitPriceChange(supabase, claims.userId, parsed.data);
  } catch (submitError) {
    return { error: submitError instanceof Error ? submitError.message : "Failed to submit price change.", success: false };
  }

  revalidatePath("/prices");
  revalidatePath("/audit/prices");
  return { error: null, success: true };
}

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// <input type="datetime-local"> values have no timezone offset — treat them
// as the operator's local time and convert to an ISO instant.
function toIsoDateTime(localValue: string): string {
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? localValue : parsed.toISOString();
}
