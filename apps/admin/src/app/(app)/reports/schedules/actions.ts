"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { ScheduleInputSchema } from "../../../../lib/reports/schedules";
import { friendlyDbError, readField, readOptional, type ActionState } from "../../../../lib/format";

const PATH = "/reports/schedules";

// report_schedules_write RLS requires created_by_user_id = caller on every
// write, so whoever last edits a schedule becomes its owner.
export async function saveSchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const scheduleId = readOptional(formData, "schedule_id");
  const parsed = ScheduleInputSchema.safeParse({
    report: readField(formData, "report"),
    format: readField(formData, "format"),
    recipient_email: readField(formData, "recipient_email"),
    cadence: readField(formData, "cadence"),
    store_id: claims.role === "store_manager" ? claims.storeId : readOptional(formData, "store_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid schedule.", success: false };

  const supabase = await createSupabaseServerClient();
  const values = { ...parsed.data, created_by_user_id: claims.userId };
  const { error } =
    scheduleId === null
      ? await supabase.from("report_schedules").insert({ ...values, params: {}, is_active: true })
      : await supabase.from("report_schedules").update(values).eq("schedule_id", scheduleId);
  if (error !== null) return { error: friendlyDbError(error, "Schedule"), success: false };
  revalidatePath(PATH);
  return { error: null, success: true };
}

export async function setScheduleActive(scheduleId: string, isActive: boolean): Promise<{ error: string | null }> {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("report_schedules")
    .update({ is_active: isActive, created_by_user_id: claims.userId })
    .eq("schedule_id", scheduleId);
  if (error !== null) return { error: friendlyDbError(error, "Schedule") };
  revalidatePath(PATH);
  return { error: null };
}

// The hourly pg_cron job picks up any schedule with last_run_at = null.
export async function queueScheduleRun(scheduleId: string): Promise<{ error: string | null }> {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("report_schedules")
    .update({ last_run_at: null, is_active: true, created_by_user_id: claims.userId })
    .eq("schedule_id", scheduleId);
  if (error !== null) return { error: friendlyDbError(error, "Schedule") };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteSchedule(scheduleId: string): Promise<{ error: string | null }> {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("report_schedules").delete().eq("schedule_id", scheduleId);
  if (error !== null) return { error: friendlyDbError(error, "Schedule") };
  revalidatePath(PATH);
  return { error: null };
}