import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// Typed view over public.system_settings (0023). Keys are seeded by the
// migration; anything unknown in the table is ignored here.
export const SETTINGS_SCHEMA = {
  adjustment_approval_threshold_qty: z.number().finite().nonnegative(),
  expiry_warning_days: z.number().int().min(1).max(365),
  low_stock_alert_emails: z.array(z.string().trim().email()).max(50),
  receipt_header: z.string().trim().max(200),
  receipt_footer: z.string().trim().max(200),
  default_report_timezone: z.string().trim().min(1).max(64),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SystemSettings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]> };

export const DEFAULT_SETTINGS: SystemSettings = {
  adjustment_approval_threshold_qty: 10,
  expiry_warning_days: 14,
  low_stock_alert_emails: [],
  receipt_header: "Harvest Group",
  receipt_footer: "Thank you for shopping with us",
  default_report_timezone: "Africa/Lusaka",
};

export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export type SettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
};

// Falls back to the default per key when a stored value fails validation,
// so one bad row can't take down every page that reads settings.
export function parseSettings(rows: readonly Pick<SettingRow, "key" | "value">[]): SystemSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in SETTINGS_SCHEMA)) continue;
    const parsed = SETTINGS_SCHEMA[row.key as SettingKey].safeParse(row.value);
    if (parsed.success) settings[row.key] = parsed.data;
  }
  return settings as SystemSettings;
}

export async function loadSettingRows(supabase: SupabaseClient): Promise<SettingRow[]> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value, description, updated_at, updated_by_user_id")
    .order("key", { ascending: true });
  if (error !== null) throw new Error(`Failed to load settings: ${error.message}`);
  const rows: SettingRow[] = data ?? [];
  return rows;
}

export async function loadSettings(supabase: SupabaseClient): Promise<SystemSettings> {
  return parseSettings(await loadSettingRows(supabase));
}

// hq_admin only — enforced by `system_settings_write_hq` RLS (0023).
export async function saveSetting<K extends SettingKey>(
  supabase: SupabaseClient,
  key: K,
  value: SystemSettings[K],
  updatedByUserId: string,
): Promise<void> {
  const parsed = SETTINGS_SCHEMA[key].parse(value);
  const { error } = await supabase.from("system_settings").upsert(
    { key, value: parsed, updated_by_user_id: updatedByUserId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error !== null) throw new Error(`Failed to save setting ${key}: ${error.message}`);
}
