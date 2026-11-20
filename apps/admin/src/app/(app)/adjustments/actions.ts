"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { buildAdjustmentEvent, NewAdjustmentSchema, requiresApproval } from "../../../lib/adjustments/service";
import { loadSettings } from "../../../lib/settings/schema";
import { friendlyDbError, readField, readOptional, type ActionState } from "../../../lib/format";

// Store managers only: adjustment_events RLS requires store_id = own store
// and requested_by_user_id = caller; HQ cannot raise store adjustments.
export async function createAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claims = await requireRole(["store_manager"]);
  if (claims.storeId === null) return { error: "Your account isn't assigned to a store.", success: false };

  const rawQty = readField(formData, "delta_qty");
  const parsed = NewAdjustmentSchema.safeParse({
    sku_id: readField(formData, "sku_id"),
    delta_qty: rawQty === "" ? Number.NaN : Number(rawQty),
    reason_code: readField(formData, "reason_code"),
    notes: readOptional(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid adjustment.", success: false };

  const supabase = await createSupabaseServerClient();
  const settings = await loadSettings(supabase);
  const needsApproval = requiresApproval(parsed.data.delta_qty, settings.adjustment_approval_threshold_qty);

  const base = { ...parsed.data, store_id: claims.storeId, adjustment_id: crypto.randomUUID(), requested_by_user_id: claims.userId };
  const requested = await supabase.from("adjustment_events").insert(buildAdjustmentEvent(base, "adjustment_requested", null));
  if (requested.error !== null) return { error: friendlyDbError(requested.error, "Adjustment"), success: false };

  if (!needsApproval) {
    const approved = await supabase.from("adjustment_events").insert(buildAdjustmentEvent(base, "adjustment_approved", claims.userId));
    if (approved.error !== null) {
      return { error: `Request recorded but auto-approval failed: ${approved.error.message}`, success: false };
    }
  }

  revalidatePath("/adjustments");
  revalidatePath("/inventory");
  return {
    error: null,
    success: true,
    message: needsApproval
      ? `Above the ${settings.adjustment_approval_threshold_qty} threshold — waiting for approval.`
      : "Applied to stock.",
  };
}
