"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { friendlyDbError, readField, readOptional, type ActionState } from "../../../lib/format";

export async function startCount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const storeId = claims.role === "store_manager" ? claims.storeId : readField(formData, "store_id");
  if (storeId === null || !z.string().uuid().safeParse(storeId).success) return { error: "Choose a store.", success: false };

  const supabase = await createSupabaseServerClient();
  const rpcResult = await supabase.rpc("start_stock_count", {
    p_store_id: storeId,
    p_category_id: readOptional(formData, "category_id"),
    p_notes: readOptional(formData, "notes"),
  });
  const data: unknown = rpcResult.data;
  const error = rpcResult.error;
  if (error !== null) return { error: friendlyDbError(error, "Stock count"), success: false };

  revalidatePath("/counts");
  redirect(`/counts/${String(data)}` as Route);
}

const CountedEntriesSchema = z.array(z.object({ sku_id: z.string().uuid(), counted_qty: z.number().finite().nonnegative().nullable() })).max(5000);

export async function saveCountedQuantities(
  countId: string,
  entries: { sku_id: string; counted_qty: number | null }[],
): Promise<{ error: string | null }> {
  await requireRole(["hq_admin", "store_manager"]);
  const parsed = CountedEntriesSchema.safeParse(entries);
  if (!parsed.success) return { error: "Counted quantities must be zero or more." };

  const supabase = await createSupabaseServerClient();
  for (const entry of parsed.data) {
    const { error } = await supabase
      .from("stock_count_lines")
      .update({ counted_qty: entry.counted_qty })
      .eq("count_id", countId)
      .eq("sku_id", entry.sku_id);
    if (error !== null) return { error: friendlyDbError(error, "Count line") };
  }
  revalidatePath(`/counts/${countId}`);
  return { error: null };
}

export async function submitCount(countId: string): Promise<{ error: string | null; corrections?: number }> {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const rpcResult = await supabase.rpc("submit_stock_count", { p_count_id: countId });
  const data: unknown = rpcResult.data;
  const error = rpcResult.error;
  if (error !== null) return { error: friendlyDbError(error, "Stock count") };
  revalidatePath("/counts");
  revalidatePath(`/counts/${countId}`);
  revalidatePath("/inventory");
  return { error: null, corrections: Number(data) };
}

export async function cancelCount(countId: string): Promise<{ error: string | null }> {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_stock_count", { p_count_id: countId });
  if (error !== null) return { error: friendlyDbError(error, "Stock count") };
  revalidatePath("/counts");
  revalidatePath(`/counts/${countId}`);
  return { error: null };
}
