"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { ProvisionTillSchema, type IssuedCredential } from "../../../lib/tills/service";
import { friendlyDbError, readField } from "../../../lib/format";

export type TillActionState = { error: string | null; issued: IssuedCredential | null };

type CredentialRow = { till_id?: string; credential: string; expires_at: string };

function firstRow(data: unknown): CredentialRow | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  return typeof row === "object" && row !== null && "credential" in row ? (row as CredentialRow) : null;
}

export async function provisionTill(_prev: TillActionState, formData: FormData): Promise<TillActionState> {
  const claims = await requireRole(["hq_admin"]);
  const parsed = ProvisionTillSchema.safeParse({
    store_id: readField(formData, "store_id"),
    label: readField(formData, "label"),
    device_identity: readField(formData, "device_identity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid till.", issued: null };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("provision_till", {
    p_store_id: parsed.data.store_id,
    p_label: parsed.data.label,
    p_device_identity: parsed.data.device_identity,
    p_operator_user_id: claims.userId,
  });
  if (error !== null) return { error: friendlyDbError(error, "A till with this label or device identity"), issued: null };

  const row = firstRow(data);
  if (row === null || row.till_id === undefined) return { error: "Provisioning returned no credential.", issued: null };
  revalidatePath("/tills");
  return { error: null, issued: { tillId: row.till_id, credential: row.credential, expiresAt: row.expires_at } };
}

export async function resetTillCredential(tillId: string): Promise<TillActionState> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_reset_till_credential", { p_till_id: tillId });
  if (error !== null) return { error: friendlyDbError(error, "Till"), issued: null };
  const row = firstRow(data);
  if (row === null) return { error: "Reset returned no credential.", issued: null };
  revalidatePath("/tills");
  return { error: null, issued: { tillId, credential: row.credential, expiresAt: row.expires_at } };
}

export async function retireTill(tillId: string, reason: string): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  if (reason.trim().length === 0) return { error: "A reason is required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("retire_till", { p_till_id: tillId, p_reason: reason.trim() });
  if (error !== null) return { error: friendlyDbError(error, "Till") };
  revalidatePath("/tills");
  return { error: null };
}