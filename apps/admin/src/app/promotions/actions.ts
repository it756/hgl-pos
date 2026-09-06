"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../lib/auth/session";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { createPromotion, updatePromotion, setPromotionActive, PromotionInputSchema } from "../../lib/promotions/promotions";

export type PromotionFormState = { error: string | null; success: boolean };

export async function savePromotion(_prevState: PromotionFormState, formData: FormData): Promise<PromotionFormState> {
  await requireRole(["hq_admin"]);

  const promotionId = readField(formData, "promotion_id");
  const storeIdInput = readField(formData, "store_id");
  const effectiveFromInput = readField(formData, "effective_from");
  const effectiveToInput = readField(formData, "effective_to");

  const parsed = PromotionInputSchema.safeParse({
    type: readField(formData, "type"),
    payload: parsePayload(readField(formData, "payload_json")),
    applies_to_sku_ids: formData.getAll("applies_to_sku_ids").filter((value): value is string => typeof value === "string"),
    store_id: storeIdInput === "" ? null : storeIdInput,
    effective_from: effectiveFromInput === "" ? null : toIsoDateTime(effectiveFromInput),
    effective_to: effectiveToInput === "" ? null : toIsoDateTime(effectiveToInput),
    is_active: formData.get("is_active") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid promotion.", success: false };
  }

  try {
    const supabase = await createSupabaseServerClient();
    if (promotionId === "") {
      await createPromotion(supabase, parsed.data);
    } else {
      await updatePromotion(supabase, promotionId, parsed.data);
    }
  } catch (submitError) {
    return { error: submitError instanceof Error ? submitError.message : "Failed to save promotion.", success: false };
  }

  revalidatePath("/promotions");
  return { error: null, success: true };
}

export async function togglePromotionActive(promotionId: string, isActive: boolean): Promise<void> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  await setPromotionActive(supabase, promotionId, isActive);
  revalidatePath("/promotions");
}

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toIsoDateTime(localValue: string): string {
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? localValue : parsed.toISOString();
}
