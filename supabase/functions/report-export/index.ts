/// <reference path="../deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildReportRows, rowsToCsv, rowsToPdf, REPORT_KINDS, type ReportKind, type ReportParams } from "../_shared/report-render.ts";

// Report export (T122, FR-034 / contracts/http-api.md "POST /report-export").
//
// Report DATA is queried using a client authenticated with the CALLER's own
// JWT (forwarded, not service role) so the existing per-table RLS policies
// (sales_read/stock_projection_read/transfers_read/shifts_read, 0009) scope
// a store_manager to their own store exactly as they would in the admin UI —
// this function does not bypass RLS for report contents.
//
// The one place this DOES use the service-role key is the Storage bucket
// write: `report-exports` only has a SELECT policy for authenticated users
// (0020) — writes are meant to go through Edge Functions only, so the
// upload/signed-URL step uses the service role client. That's a narrow,
// documented exception, not a general RLS bypass.
//
// Implemented synchronously (no `report_jobs` table / background queue) —
// the contract's `status: "queued"` + poll_url shape is for a future async
// path; v1 always returns `status: "completed"` immediately alongside a
// signed download URL.

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};

const FORMATS = ["csv", "pdf"] as const;
type Format = (typeof FORMATS)[number];

const SIGNED_URL_TTL_SECONDS = 3600;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.toLowerCase().startsWith("bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const callerRole = readPosRole(authorization.slice("bearer ".length));
  if (callerRole !== "hq_admin" && callerRole !== "store_manager") {
    return json({ error: "forbidden", detail: "report-export requires hq_admin or store_manager" }, 403);
  }

  const body = await readJson(request);
  const parsed = parseRequestBody(body);
  if (parsed instanceof Response) return parsed;
  const { report, params, format } = parsed;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === undefined || supabaseAnonKey === undefined || serviceRoleKey === undefined) {
    return json({ error: "server_misconfigured" }, 500);
  }

  const callerScopedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rows;
  try {
    rows = await buildReportRows(callerScopedSupabase, report, params);
  } catch (caught) {
    return json({ error: "report_query_failed", detail: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }

  const fileBytes = format === "csv" ? new TextEncoder().encode(rowsToCsv(rows)) : rowsToPdf(reportTitle(report), rows);
  const contentType = format === "csv" ? "text/csv" : "application/pdf";
  const jobId = crypto.randomUUID();
  const storagePrefix = params.store_id ?? "consolidated";
  const objectPath = `${storagePrefix}/${report}-${jobId}.${format}`;

  const serviceRoleSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const uploadResult = await serviceRoleSupabase.storage.from("report-exports").upload(objectPath, fileBytes, {
    contentType,
    upsert: true,
  });
  if (uploadResult.error !== null) {
    return json({ error: "upload_failed", detail: uploadResult.error.message }, 500);
  }

  const signedUrlResult = await serviceRoleSupabase.storage.from("report-exports").createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signedUrlResult.error !== null) {
    return json({ error: "signed_url_failed", detail: signedUrlResult.error.message }, 500);
  }

  return json({
    job_id: jobId,
    status: "completed",
    poll_url: `/report-export/status/${jobId}`,
    download_url: signedUrlResult.data.signedUrl,
    row_count: rows.length,
  });
});

function reportTitle(report: ReportKind): string {
  return report.replace(/_/g, " ");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRequestBody(value: unknown): { report: ReportKind; params: ReportParams; format: Format } | Response {
  if (!isRecord(value)) return json({ error: "invalid_json" }, 400);

  const report = value.report;
  if (typeof report !== "string" || !REPORT_KINDS.includes(report as ReportKind)) {
    return json({ error: "invalid_field", field: "report" }, 400);
  }

  const format = value.format;
  if (format !== "csv" && format !== "pdf") {
    return json({ error: "invalid_field", field: "format" }, 400);
  }

  const paramsValue = value.params;
  if (!isRecord(paramsValue) || typeof paramsValue.from !== "string" || typeof paramsValue.to !== "string") {
    return json({ error: "invalid_field", field: "params" }, 400);
  }
  if (Number.isNaN(new Date(paramsValue.from).getTime()) || Number.isNaN(new Date(paramsValue.to).getTime())) {
    return json({ error: "invalid_field", field: "params.from/to" }, 400);
  }
  const storeId = typeof paramsValue.store_id === "string" && paramsValue.store_id.length > 0 ? paramsValue.store_id : undefined;

  return {
    report: report as ReportKind,
    format,
    params: { from: paramsValue.from, to: paramsValue.to, store_id: storeId },
  };
}

function readPosRole(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (payload === null) return null;
  const appMetadata = isRecord(payload.app_metadata) ? payload.app_metadata : null;
  const fromAppMetadata = appMetadata !== null && typeof appMetadata.role === "string" ? appMetadata.role : null;
  const fromPosRole = typeof payload.pos_role === "string" ? payload.pos_role : null;
  return fromAppMetadata ?? fromPosRole;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
