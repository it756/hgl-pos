/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildReportRows, rowsToCsv, rowsToPdf, type ReportKind } from "../_shared/report-render.ts";

// Report scheduler (T123, pg_cron-triggered scheduled email delivery).
// Mirrors low-stock-alerts/sync-health-alerts: service-role gated, no
// user session to forward. Triggered hourly by pg_cron's
// `public.trigger_report_scheduler()` (migration 0020) via pg_net, which
// calls this function with `Authorization: Bearer <service role key>`.
//
// Each `report_schedules` row is only ever created (0020's
// report_schedules_write policy) by an authenticated hq_admin/store_manager
// scoped to their own store_id — that's where its authorization comes from.
// This cron-triggered run re-applies the SAME store_id filter recorded on
// the schedule when building rows via the service-role client (which
// otherwise bypasses RLS), so a schedule can never read outside the scope
// its creator was already allowed to see.
//
// No SMTP/email-provider integration exists anywhere in this repo yet.
// Delivery is stubbed via a configurable webhook (REPORT_EMAIL_WEBHOOK_URL),
// the same fallback shape low-stock-alerts already established for
// WhatsApp/SMS-style downstream delivery — a real transactional-email
// integration is left as follow-up.

type ReportSchedule = {
  schedule_id: string;
  report: ReportKind;
  params: { from?: string; to?: string; store_id?: string };
  format: "csv" | "pdf";
  recipient_email: string;
  store_id: string | null;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (serviceRoleKey === undefined || authorization !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const dueResult = await supabase.rpc("due_report_schedules");
  if (dueResult.error !== null) {
    return json({ error: "due_schedules_query_failed", detail: dueResult.error.message }, 500);
  }

  const schedules: ReportSchedule[] = Array.isArray(dueResult.data) ? dueResult.data : [];
  const webhookUrl = Deno.env.get("REPORT_EMAIL_WEBHOOK_URL");

  let processed = 0;
  let emailed = 0;
  let failed = 0;

  for (const schedule of schedules) {
    try {
      await runSchedule(supabase, schedule, webhookUrl);
      processed += 1;
      if (webhookUrl !== undefined) emailed += 1;
    } catch (caught) {
      failed += 1;
      console.error(`report schedule ${schedule.schedule_id} failed:`, caught instanceof Error ? caught.message : caught);
    }
  }

  return json({ due_count: schedules.length, processed, emailed, failed });
});

async function runSchedule(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  schedule: ReportSchedule,
  webhookUrl: string | undefined,
): Promise<void> {
  const from = schedule.params.from ?? defaultRangeStart();
  const to = schedule.params.to ?? defaultRangeEnd();
  const storeId = schedule.store_id ?? schedule.params.store_id;

  const rows = await buildReportRows(supabase, schedule.report, { from, to, store_id: storeId ?? undefined });
  const fileBytes = schedule.format === "csv" ? new TextEncoder().encode(rowsToCsv(rows)) : rowsToPdf(schedule.report.replace(/_/g, " "), rows);
  const contentType = schedule.format === "csv" ? "text/csv" : "application/pdf";
  const objectPath = `${storeId ?? "consolidated"}/${schedule.report}-${schedule.schedule_id}-${Date.now()}.${schedule.format}`;

  const uploadResult = await supabase.storage.from("report-exports").upload(objectPath, fileBytes, { contentType, upsert: true });
  if (uploadResult.error !== null) throw new Error(`upload failed: ${uploadResult.error.message}`);

  const signedUrlResult = await supabase.storage.from("report-exports").createSignedUrl(objectPath, 60 * 60 * 24);
  if (signedUrlResult.error !== null) throw new Error(`signed url failed: ${signedUrlResult.error.message}`);

  if (webhookUrl !== undefined) {
    await postToWebhook(webhookUrl, schedule, signedUrlResult.data.signedUrl, rows.length);
  }

  const updateResult = await supabase
    .from("report_schedules")
    .update({ last_run_at: new Date().toISOString() })
    .eq("schedule_id", schedule.schedule_id);
  if (updateResult.error !== null) throw new Error(`failed to mark schedule as run: ${updateResult.error.message}`);
}

async function postToWebhook(webhookUrl: string, schedule: ReportSchedule, downloadUrl: string, rowCount: number): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "report_schedule_delivery",
      recipient_email: schedule.recipient_email,
      report: schedule.report,
      format: schedule.format,
      download_url: downloadUrl,
      row_count: rowCount,
    }),
  });
  if (!response.ok) {
    throw new Error(`report email webhook failed with HTTP ${response.status}`);
  }
}

function defaultRangeStart(): string {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function defaultRangeEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
