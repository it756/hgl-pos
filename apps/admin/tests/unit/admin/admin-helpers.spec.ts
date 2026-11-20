import { describe, expect, it } from "vitest";
import { parseSettings, DEFAULT_SETTINGS } from "../../../src/lib/settings/schema";
import { parseSettingsForm } from "../../../src/lib/settings/form";
import { requiresApproval, foldAdjustmentHistory, NewAdjustmentSchema, type AdjustmentEventRow } from "../../../src/lib/adjustments/service";
import { lineVariance, parseCountedValue } from "../../../src/lib/counts/service";
import { nextDueAt, ScheduleInputSchema } from "../../../src/lib/reports/schedules";
import { CustomerInputSchema, normalizePhone, sanitizeSearch } from "../../../src/lib/customers/service";
import { InviteStaffSchema } from "../../../src/lib/users/staff";
import { StoreInputSchema } from "../../../src/lib/stores/service";
import { friendlyDbError } from "../../../src/lib/format";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("settings", () => {
  it("falls back to defaults per key when stored values are invalid", () => {
    const settings = parseSettings([
      { key: "adjustment_approval_threshold_qty", value: 25 },
      { key: "expiry_warning_days", value: "soon" },
      { key: "unknown_key", value: 1 },
    ]);
    expect(settings.adjustment_approval_threshold_qty).toBe(25);
    expect(settings.expiry_warning_days).toBe(DEFAULT_SETTINGS.expiry_warning_days);
  });

  it("parses the settings form, splitting email lists and rejecting bad timezones", () => {
    const base = {
      adjustment_approval_threshold_qty: "5",
      expiry_warning_days: "30",
      low_stock_alert_emails: "a@x.com, b@y.com\nc@z.com",
      receipt_header: "Hi",
      receipt_footer: "Bye",
      default_report_timezone: "Africa/Lusaka",
    };
    const ok = parseSettingsForm(form(base));
    expect(ok.error).toBeNull();
    expect(ok.values.low_stock_alert_emails).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
    expect(parseSettingsForm(form({ ...base, default_report_timezone: "Mars/Olympus" })).error).toMatch(/timezone/);
    expect(parseSettingsForm(form({ ...base, low_stock_alert_emails: "nope" })).error).toMatch(/low stock alert emails/);
  });
});

describe("adjustments", () => {
  it("auto-approves at or below the threshold in either direction", () => {
    expect(requiresApproval(-10, 10)).toBe(false);
    expect(requiresApproval(10.001, 10)).toBe(true);
    expect(requiresApproval(-11, 10)).toBe(true);
  });

  it("requires notes for reason 'other' and rejects zero quantities", () => {
    const sku_id = "11111111-1111-4111-8111-111111111111";
    expect(NewAdjustmentSchema.safeParse({ sku_id, delta_qty: 2, reason_code: "other", notes: null }).success).toBe(false);
    expect(NewAdjustmentSchema.safeParse({ sku_id, delta_qty: 0, reason_code: "damaged", notes: null }).success).toBe(false);
    expect(NewAdjustmentSchema.safeParse({ sku_id, delta_qty: -3, reason_code: "damaged", notes: null }).success).toBe(true);
  });

  it("folds request/resolve events into one history row each", () => {
    const base = { store_id: "s", sku_id: "k", delta_qty: 4, reason_code: "found", requested_by_user_id: "u1", notes: null, event_id: "e", till_id: "t" };
    const rows = [
      { ...base, adjustment_id: "a", event_kind: "adjustment_requested", server_ts: "2026-01-01T00:00:00Z", approver_user_id: null },
      { ...base, adjustment_id: "a", event_kind: "adjustment_approved", server_ts: "2026-01-01T01:00:00Z", approver_user_id: "u2" },
      { ...base, adjustment_id: "b", event_kind: "adjustment_requested", server_ts: "2026-01-02T00:00:00Z", approver_user_id: null },
    ] as unknown as AdjustmentEventRow[];
    const history = foldAdjustmentHistory(rows);
    expect(history.map((row) => [row.adjustment_id, row.outcome, row.approver_user_id])).toEqual([
      ["b", "pending", null],
      ["a", "approved", "u2"],
    ]);
  });
});

describe("stock counts", () => {
  it("computes variance against the snapshot and validates counted input", () => {
    expect(lineVariance({ expected_qty: 10, counted_qty: 7.5 })).toBe(-2.5);
    expect(lineVariance({ expected_qty: 10, counted_qty: null })).toBeNull();
    expect(parseCountedValue("")).toBeNull();
    expect(parseCountedValue(" 3.1234 ")).toBe(3.123);
    expect(parseCountedValue("-1")).toBe("invalid");
    expect(parseCountedValue("abc")).toBe("invalid");
  });
});

describe("report schedules", () => {
  it("mirrors due_report_schedules() cadence logic", () => {
    expect(nextDueAt({ is_active: false, cadence: "daily", last_run_at: null })).toBeNull();
    expect(nextDueAt({ is_active: true, cadence: "daily", last_run_at: null })).toBe("next_run");
    expect(nextDueAt({ is_active: true, cadence: "weekly", last_run_at: "2026-01-01T00:00:00.000Z" })).toEqual(new Date("2026-01-08T00:00:00.000Z"));
  });

  it("validates recipient email", () => {
    const valid = { report: "sales_by_store", format: "csv", cadence: "daily", store_id: null, recipient_email: " Ops@Example.com " };
    expect(ScheduleInputSchema.parse(valid).recipient_email).toBe("ops@example.com");
    expect(ScheduleInputSchema.safeParse({ ...valid, recipient_email: "nope" }).success).toBe(false);
  });
});

describe("customers", () => {
  it("normalizes phones so formatting variants collide on the unique index", () => {
    expect(normalizePhone("+260 97 123-4567")).toBe("+260971234567");
    expect(normalizePhone("   ")).toBeNull();
    const parsed = CustomerInputSchema.parse({
      full_name: " Jane ",
      phone: "(097) 123 4567",
      email: "",
      loyalty_tier_id: null,
      credit_limit: null,
      home_store_id: null,
      notes: "",
    });
    expect(parsed).toMatchObject({ full_name: "Jane", phone: "0971234567", email: null, notes: null });
    expect(CustomerInputSchema.safeParse({ ...parsed, phone: "12" }).success).toBe(false);
  });

  it("strips PostgREST filter metacharacters from search terms", () => {
    expect(sanitizeSearch("ann,phone.eq.1)*%")).toBe("ann phone.eq.1");
  });
});

describe("staff and stores", () => {
  const staff = { full_name: "A", email: "a@b.co", password: "x".repeat(12), pin: "1234" };
  it("enforces the hq_admin/store scope rule from users_hq_admin_store_scope", () => {
    expect(InviteStaffSchema.safeParse({ ...staff, role: "hq_admin", store_id: null }).success).toBe(true);
    expect(InviteStaffSchema.safeParse({ ...staff, role: "store_manager", store_id: null }).success).toBe(false);
    expect(InviteStaffSchema.safeParse({ ...staff, role: "hq_admin", store_id: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
    expect(InviteStaffSchema.safeParse({ ...staff, password: "short", role: "hq_admin", store_id: null }).success).toBe(false);
  });

  it("validates store codes, timezones and thresholds", () => {
    const store = { code: "LSK-01", name: "Lusaka", region: null, timezone: "Africa/Lusaka", offline_threshold_minutes_trading: 240, offline_threshold_minutes_overnight: 1440 };
    expect(StoreInputSchema.safeParse(store).success).toBe(true);
    expect(StoreInputSchema.safeParse({ ...store, code: "bad code" }).success).toBe(false);
    expect(StoreInputSchema.safeParse({ ...store, timezone: "Nowhere/Land" }).success).toBe(false);
    expect(StoreInputSchema.safeParse({ ...store, offline_threshold_minutes_trading: 0 }).success).toBe(false);
  });

  it("maps Postgres error codes to readable messages", () => {
    expect(friendlyDbError({ code: "23505", message: "dup" }, "A store with this code")).toBe("A store with this code already exists.");
    expect(friendlyDbError({ code: "42501", message: "rls" }, "X")).toMatch(/permission/);
  });
});
