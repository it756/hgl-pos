"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { InviteStaffSchema, UpdateStaffSchema } from "../../../lib/users/staff";
import { friendlyDbError, readField, readOptional, type ActionState } from "../../../lib/format";

async function functionErrorDetail(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { error?: string; detail?: string; field?: string };
      if (body.field !== undefined) return `Invalid ${body.field.replace(/_/g, " ")}.`;
      return body.detail ?? body.error ?? context.statusText;
    } catch {
      return context.statusText;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function inviteStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin"]);
  const role = readField(formData, "role");
  const parsed = InviteStaffSchema.safeParse({
    full_name: readField(formData, "full_name"),
    email: readField(formData, "email"),
    role,
    store_id: role === "hq_admin" ? null : readOptional(formData, "store_id"),
    password: formData.get("password") ?? "",
    pin: readField(formData, "pin"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid staff details.", success: false };

  const supabase = await createSupabaseServerClient();
  const hashed = await supabase.functions.invoke<{ hash: string }>("hash-cashier-pin", { body: { pin: parsed.data.pin } });
  if (hashed.error !== null || hashed.data === null) {
    return { error: `Failed to hash PIN: ${await functionErrorDetail(hashed.error)}`, success: false };
  }

  const invited = await supabase.functions.invoke<{ user_id: string }>("invite-staff-user", {
    body: {
      email: parsed.data.email,
      password: parsed.data.password,
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      store_id: parsed.data.store_id,
      pin_hash: hashed.data.hash,
    },
  });
  if (invited.error !== null) {
    return { error: `Failed to create staff login: ${await functionErrorDetail(invited.error)}`, success: false };
  }

  revalidatePath("/users");
  return { error: null, success: true, message: `${parsed.data.full_name} can now sign in as ${parsed.data.email}.` };
}

export async function updateStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claims = await requireRole(["hq_admin"]);
  const role = readField(formData, "role");
  const parsed = UpdateStaffSchema.safeParse({
    user_id: readField(formData, "user_id"),
    full_name: readField(formData, "full_name"),
    role,
    store_id: role === "hq_admin" ? null : readOptional(formData, "store_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid staff details.", success: false };
  if (parsed.data.user_id === claims.userId && parsed.data.role !== "hq_admin") {
    return { error: "You can't remove your own HQ admin role.", success: false };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("users")
    .update({
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      store_id: parsed.data.store_id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", parsed.data.user_id)
    .neq("role", "cashier");
  if (error !== null) return { error: friendlyDbError(error, "Staff member"), success: false };

  revalidatePath("/users");
  return { error: null, success: true };
}

export async function setStaffActive(userId: string, isActive: boolean): Promise<{ error: string | null }> {
  const claims = await requireRole(["hq_admin"]);
  if (userId === claims.userId && !isActive) return { error: "You can't deactivate your own account." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("users")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error !== null) return { error: friendlyDbError(error, "Staff member") };
  revalidatePath("/users");
  return { error: null };
}