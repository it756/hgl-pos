"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { StoreInputSchema } from "../../../lib/stores/service";
import { friendlyDbError, readField, readOptional, type ActionState } from "../../../lib/format";

export async function saveStore(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin"]);
  const storeId = readOptional(formData, "store_id");
  const parsed = StoreInputSchema.safeParse({
    code: readField(formData, "code"),
    name: readField(formData, "name"),
    region: readOptional(formData, "region"),
    timezone: readField(formData, "timezone") || "Africa/Lusaka",
    offline_threshold_minutes_trading: Number(readField(formData, "offline_threshold_minutes_trading")),
    offline_threshold_minutes_overnight: Number(readField(formData, "offline_threshold_minutes_overnight")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid store.", success: false };

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } =
    storeId === null
      ? await supabase.from("stores").insert({ store_id: randomUUID(), ...parsed.data, created_at: nowIso, updated_at: nowIso })
      : await supabase.from("stores").update({ ...parsed.data, updated_at: nowIso }).eq("store_id", storeId);
  if (error !== null) return { error: friendlyDbError(error, "A store with this code"), success: false };

  revalidatePath("/stores");
  return { error: null, success: true };
}