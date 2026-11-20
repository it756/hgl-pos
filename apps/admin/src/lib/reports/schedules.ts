import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const SCHEDULED_REPORTS = [
  { value: "sales_by_store", label: "Sales by store" },
  { value: "sales_by_cashier", label: "Sales by cashier" },
  { value: "sales_by_sku", label: "Sales by SKU" },
  { value: "inventory_on_hand", label: "Inventory on hand" },
  { value: "transfer_history", label: "Transfer history" },
  { value: "till_reconciliation", label: "Till reconciliation" },
] as const;

export type ScheduledReport = (typeof SCHEDULED_REPORTS)[number]["value"];

export type ReportScheduleRow = {
  schedule_id: string;
  report: ScheduledReport;
  format: "csv" | "pdf";
  recipient_email: string;
  cadence: "daily" | "weekly";
  store_id: string | null;
  created_by_user_id: string;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
};

export const ScheduleInputSchema = z.object({
  report: z.enum(SCHEDULED_REPORTS.map((report) => report.value) as [ScheduledReport, ...ScheduledReport[]]),
  format: z.enum(["csv", "pdf"]),
  recipient_email: z.string().trim().toLowerCase().email("Enter a valid recipient email"),
  cadence: z.enum(["daily", "weekly"]),
  store_id: z.string().uuid().nullable(),
});
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

// Mirrors due_report_schedules() (0020) so the UI can say when a schedule
// will next be picked up by the hourly cron run.
export function nextDueAt(schedule: Pick<ReportScheduleRow, "is_active" | "cadence" | "last_run_at">): Date | "next_run" | null {
  if (!schedule.is_active) return null;
  if (schedule.last_run_at === null) return "next_run";
  const days = schedule.cadence === "daily" ? 1 : 7;
  return new Date(new Date(schedule.last_run_at).getTime() + days * 24 * 60 * 60 * 1000);
}

export async function listSchedules(supabase: SupabaseClient): Promise<ReportScheduleRow[]> {
  const { data, error } = await supabase
    .from("report_schedules")
    .select("schedule_id, report, format, recipient_email, cadence, store_id, created_by_user_id, is_active, last_run_at, created_at")
    .order("created_at", { ascending: false });
  if (error !== null) throw new Error(`Failed to load report schedules: ${error.message}`);
  return (data ?? []);
}
