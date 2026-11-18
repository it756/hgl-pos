import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type TillRow = {
  till_id: string;
  store_id: string;
  label: string;
  device_identity: string;
  provisioned_at: string | null;
  retired_at: string | null;
  last_heartbeat_at: string | null;
  last_successful_sync_at: string | null;
  app_version: string | null;
  queue_depth: number | null;
};

export type IssuedCredential = {
  tillId: string;
  credential: string;
  expiresAt: string;
};

export const ProvisionTillSchema = z.object({
  store_id: z.string().uuid("Pick a store"),
  label: z.string().trim().min(1, "Label is required").max(40),
  device_identity: z.string().trim().min(3, "Device identity is required").max(200),
});

type HealthRow = Pick<TillRow, "till_id" | "last_successful_sync_at" | "app_version" | "queue_depth"> & { server_ts: string | null };

// device_credential_hash is deliberately never selected.
export async function listTills(supabase: SupabaseClient): Promise<TillRow[]> {
  const [tillsResult, healthResult] = await Promise.all([
    supabase
      .from("tills")
      .select("till_id, store_id, label, device_identity, provisioned_at, retired_at")
      .order("store_id", { ascending: true })
      .order("label", { ascending: true }),
    supabase.from("sync_health_latest_by_till").select("till_id, server_ts, last_successful_sync_at, app_version, queue_depth"),
  ]);
  if (tillsResult.error !== null) throw new Error(`Failed to load tills: ${tillsResult.error.message}`);
  if (healthResult.error !== null) throw new Error(`Failed to load till health: ${healthResult.error.message}`);

  const health = new Map(((healthResult.data ?? []) as HealthRow[]).map((row) => [row.till_id, row]));
  return ((tillsResult.data ?? []) as Omit<TillRow, "last_heartbeat_at" | "last_successful_sync_at" | "app_version" | "queue_depth">[]).map(
    (till) => {
      const latest = health.get(till.till_id);
      return {
        ...till,
        last_heartbeat_at: latest?.server_ts ?? null,
        last_successful_sync_at: latest?.last_successful_sync_at ?? null,
        app_version: latest?.app_version ?? null,
        queue_depth: latest?.queue_depth ?? null,
      };
    },
  );
}