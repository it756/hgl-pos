import { SETTINGS_SCHEMA, SETTING_KEYS, type SettingKey, type SystemSettings } from "./schema";
import { readField } from "../format";
export function parseSettingsForm(formData: FormData): { values: Partial<SystemSettings>; error: string | null } {
  const raw: Record<SettingKey, unknown> = {
    adjustment_approval_threshold_qty: Number(readField(formData, "adjustment_approval_threshold_qty")),
    expiry_warning_days: Number(readField(formData, "expiry_warning_days")),
    low_stock_alert_emails: readField(formData, "low_stock_alert_emails")
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter((email) => email.length > 0),
    receipt_header: readField(formData, "receipt_header"),
    receipt_footer: readField(formData, "receipt_footer"),
    default_report_timezone: readField(formData, "default_report_timezone"),
  };

  const values: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const parsed = SETTINGS_SCHEMA[key].safeParse(raw[key]);
    if (!parsed.success) {
      return { values: {}, error: `${key.replace(/_/g, " ")}: ${parsed.error.issues[0]?.message ?? "invalid value"}` };
    }
    values[key] = parsed.data;
  }
  if (!isValidTimeZone(values.default_report_timezone as string)) {
    return { values: {}, error: "default report timezone: unknown IANA timezone" };
  }
  return { values: values as Partial<SystemSettings>, error: null };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
