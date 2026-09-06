"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { upsertRolloutRecord, RolloutRecordInputSchema } from "../../../lib/rollout/service";

export type RolloutRecordFormState = { error: string | null; success: boolean };

export async function saveRolloutRecord(
  _prevState: RolloutRecordFormState,
  formData: FormData,
): Promise<RolloutRecordFormState> {
  const claims = await requireRole(["hq_admin"]);

  const notesInput = readField(formData, "notes");
  const parsed = RolloutRecordInputSchema.safeParse({
    store_id: readField(formData, "store_id"),
    app_version: readField(formData, "app_version"),
    pilot_soak_result: readField(formData, "pilot_soak_result"),
    offline_drill_result: readField(formData, "offline_drill_result"),
    schema_compat_verified: formData.get("schema_compat_verified") === "on",
    notes: notesInput === "" ? null : notesInput,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rollout record.", success: false };
  }

  try {
    const supabase = await createSupabaseServerClient();
    await upsertRolloutRecord(supabase, claims.userId, parsed.data);
  } catch (submitError) {
    return { error: submitError instanceof Error ? submitError.message : "Failed to save rollout record.", success: false };
  }

  revalidatePath("/rollout");
  return { error: null, success: true };
}

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
