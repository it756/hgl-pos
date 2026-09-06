import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// Rollout record tracking (T129, US8/SC-008): one row per store per
// app_version capturing the three go/no-go signals a canary rollout stage
// needs before progressing to the next store cohort (docs/ops/canary.md).
// Plain table, not event-sourced — HQ admins write it directly from the
// admin console as each signal becomes available; RLS (0019) restricts
// writes to hq_admin and scopes store_manager reads to their own store.

export const RolloutRecordInputSchema = z.object({
  store_id: z.string().uuid(),
  app_version: z.string().trim().min(1).max(100),
  pilot_soak_result: z.enum(["pending", "pass", "fail"]),
  offline_drill_result: z.enum(["pending", "pass", "fail"]),
  schema_compat_verified: z.boolean(),
  notes: z.string().trim().max(1000).nullable(),
});
export type RolloutRecordInput = z.infer<typeof RolloutRecordInputSchema>;

export type RolloutRecord = RolloutRecordInput & {
  rollout_record_id: string;
  store_code: string;
  store_name: string;
  created_at: string;
  updated_at: string;
};

type RolloutRecordRow = {
  rollout_record_id: string;
  store_id: string;
  app_version: string;
  pilot_soak_result: "pending" | "pass" | "fail";
  offline_drill_result: "pending" | "pass" | "fail";
  schema_compat_verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  stores: { code: string; name: string } | { code: string; name: string }[] | null;
};

export async function loadRolloutRecords(supabase: SupabaseClient): Promise<RolloutRecord[]> {
  const { data, error } = await supabase
    .from("rollout_records")
    .select(
      "rollout_record_id, store_id, app_version, pilot_soak_result, offline_drill_result, schema_compat_verified, notes, created_at, updated_at, stores(code, name)",
    )
    .order("created_at", { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to load rollout records: ${error.message}`);
  }

  const rows: RolloutRecordRow[] = data ?? [];
  return rows.map((row) => {
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
    return {
      rollout_record_id: row.rollout_record_id,
      store_id: row.store_id,
      store_code: store?.code ?? row.store_id,
      store_name: store?.name ?? "Unknown store",
      app_version: row.app_version,
      pilot_soak_result: row.pilot_soak_result,
      offline_drill_result: row.offline_drill_result,
      schema_compat_verified: row.schema_compat_verified,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

export async function upsertRolloutRecord(supabase: SupabaseClient, userId: string, input: RolloutRecordInput): Promise<void> {
  const { error } = await supabase
    .from("rollout_records")
    .upsert(
      {
        store_id: input.store_id,
        app_version: input.app_version,
        pilot_soak_result: input.pilot_soak_result,
        offline_drill_result: input.offline_drill_result,
        schema_compat_verified: input.schema_compat_verified,
        notes: input.notes,
        created_by_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,app_version" },
    );

  if (error !== null) {
    throw new Error(`Failed to save rollout record: ${error.message}`);
  }
}
