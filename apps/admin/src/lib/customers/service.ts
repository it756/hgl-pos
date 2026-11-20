import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type LoyaltyTier = { tier_id: string; code: string; name: string; rank: number; is_active: boolean };

export type CustomerRow = {
  customer_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  loyalty_tier_id: string | null;
  credit_limit: number | null;
  home_store_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export const CUSTOMER_PAGE_SIZE = 50;

// Phones are stored without spaces/dashes so the unique index catches
// "+260 97 1234567" and "+260971234567" as the same number.
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s()-]/g, "");
  return compact === "" ? null : compact;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

export const CustomerInputSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(160),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^\+?\d{7,15}$/, "Phone must be 7-15 digits, optionally starting with +").nullable()),
  email: optionalText(254).pipe(z.string().email("Enter a valid email").nullable()),
  loyalty_tier_id: z.string().uuid().nullable(),
  credit_limit: z.number().finite().nonnegative("Credit limit can't be negative").nullable(),
  home_store_id: z.string().uuid().nullable(),
  notes: optionalText(1000),
});
export type CustomerInput = z.infer<typeof CustomerInputSchema>;

export const TierInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, - and _"),
  name: z.string().trim().min(1, "Name is required").max(80),
  rank: z.number().int().min(0).max(1000),
});

export async function listTiers(supabase: SupabaseClient): Promise<LoyaltyTier[]> {
  const { data, error } = await supabase.from("loyalty_tiers").select("tier_id, code, name, rank, is_active").order("rank").order("name");
  if (error !== null) throw new Error(`Failed to load loyalty tiers: ${error.message}`);
  return (data ?? []);
}

// Strips PostgREST filter syntax characters so a search term can't inject
// extra conditions into the `.or()` expression.
export function sanitizeSearch(term: string): string {
  return term.replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

export async function listCustomers(
  supabase: SupabaseClient,
  options: { search: string; status: "active" | "inactive" | "all"; page: number },
): Promise<{ rows: CustomerRow[]; total: number }> {
  let query = supabase
    .from("customers")
    .select("customer_id, full_name, phone, email, loyalty_tier_id, credit_limit, home_store_id, notes, is_active, created_at", { count: "exact" });
  const term = sanitizeSearch(options.search);
  if (term !== "") {
    const phone = normalizePhone(term) ?? term;
    query = query.or(`full_name.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${phone}*`);
  }
  if (options.status !== "all") query = query.eq("is_active", options.status === "active");
  const start = (options.page - 1) * CUSTOMER_PAGE_SIZE;
  const { data, error, count } = await query.order("full_name").range(start, start + CUSTOMER_PAGE_SIZE - 1);
  if (error !== null) throw new Error(`Failed to load customers: ${error.message}`);
  return { rows: (data ?? []), total: count ?? 0 };
}
