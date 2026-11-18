"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadSettings, saveSetting, SETTING_KEYS, type SystemSettings } from "../../../lib/settings/schema";
import { parseSettingsForm } from "../../../lib/settings/form";
import type { ActionState } from "../../../lib/format";

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claims = await requireRole(["hq_admin"]);
  const { values, error } = parseSettingsForm(formData);
  if (error !== null) return { error, success: false };

  try {
    const supabase = await createSupabaseServerClient();
    const current = await loadSettings(supabase);
    const changed = SETTING_KEYS.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(values[key]));
    for (const key of changed) {
      await saveSetting(supabase, key, values[key] as SystemSettings[typeof key], claims.userId);
    }
    revalidatePath("/settings");
    return { error: null, success: true, message: changed.length === 0 ? "No changes." : `Saved ${changed.length} setting(s).` };
  } catch (saveError) {
    return { error: saveError instanceof Error ? saveError.message : "Failed to save settings.", success: false };
  }
}