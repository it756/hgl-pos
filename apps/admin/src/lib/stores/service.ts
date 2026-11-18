import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type StoreRow = {
  store_id: string;
  code: string;
  name: string;
  region: string | null;
  timezone: string;
  offline_threshold_minutes_trading: number;
  offline_threshold_minutes_overnight: number;
  created_at: string;
  updated_at: string;
  till_count: number;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const StoreInputSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20).regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, - and _"),
  name: z.string().trim().min(1, "Name is required").max(120),
  region: z.string().trim().max(120).nullable(),
  timezone: z.string().trim().refine(isValidTimeZone, "Unknown IANA timezone"),
  offline_threshold_minutes_trading: z.number().int().positive("Trading threshold must be > 0"),
  offline_threshold_minutes_overnight: z.number().int().positive("Overnight threshold must be > 0"),
});
export type StoreInput = z.infer<typeof StoreInputSchema>;

type StoreQueryRow = Omit<StoreRow, "till_count"> & { tills: { count: number }[] | null };

export async function listStores(supabase: SupabaseClient): Promise<StoreRow[]> {
  const { data, error } = await supabase
    .from("stores")
    .select(
      "store_id, code, name, region, timezone, offline_threshold_minutes_trading, offline_threshold_minutes_overnight, created_at, updated_at, tills(count)",
    )
    .order("code", { ascending: true });
  if (error !== null) throw new Error(`Failed to load stores: ${error.message}`);
  const rows = (data ?? []) as StoreQueryRow[];
  return rows.map(({ tills, ...store }) => ({ ...store, till_count: tills?.[0]?.count ?? 0 }));
}