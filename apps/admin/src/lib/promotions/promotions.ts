import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const DiscountPctSchema = z.number().min(0).max(100);

export const DateRangeDiscountPayloadSchema = z.object({
  discount_pct: DiscountPctSchema,
});
export const BogoPayloadSchema = z.object({
  buy: z.number().int().positive(),
  get: z.number().int().positive(),
  discount_pct: DiscountPctSchema,
});
export const BundlePayloadSchema = z.object({
  bundle_sku_ids: z.array(z.string().uuid()).min(2),
  bundle_price: z.number().finite().nonnegative(),
});
export const LoyaltyTierPayloadSchema = z.object({
  tier: z.string().trim().min(1),
  discount_pct: DiscountPctSchema,
});

export const PromotionTypeSchema = z.enum(["date_range_discount", "bogo", "bundle", "loyalty_tier"]);
export type PromotionType = z.infer<typeof PromotionTypeSchema>;

export const PromotionInputSchema = z
  .object({
    type: PromotionTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    applies_to_sku_ids: z.array(z.string().uuid()),
    store_id: z.string().uuid().nullable(),
    effective_from: z.string().datetime({ offset: true }).nullable(),
    effective_to: z.string().datetime({ offset: true }).nullable(),
    is_active: z.boolean(),
  })
  .refine((input) => input.effective_to === null || input.effective_from === null || input.effective_to > input.effective_from, {
    message: "effective_to must be after effective_from",
    path: ["effective_to"],
  })
  .refine((input) => PAYLOAD_SCHEMA_BY_TYPE[input.type].safeParse(input.payload).success, {
    message: "payload does not match the fields required for this promotion type",
    path: ["payload"],
  });
export type PromotionInput = z.infer<typeof PromotionInputSchema>;

const PAYLOAD_SCHEMA_BY_TYPE: Record<PromotionType, z.ZodTypeAny> = {
  date_range_discount: DateRangeDiscountPayloadSchema,
  bogo: BogoPayloadSchema,
  bundle: BundlePayloadSchema,
  loyalty_tier: LoyaltyTierPayloadSchema,
};

export type Promotion = {
  promotion_id: string;
  type: PromotionType;
  payload: Record<string, unknown>;
  applies_to_sku_ids: string[] | null;
  store_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listPromotions(supabase: SupabaseClient): Promise<Promotion[]> {
  const { data, error } = await supabase.from("promotions").select("*").order("created_at", { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to load promotions: ${error.message}`);
  }

  return (data ?? []) as Promotion[];
}

export async function createPromotion(supabase: SupabaseClient, input: PromotionInput): Promise<Promotion> {
  const parsed = PromotionInputSchema.parse(input);

  const result = await supabase
    .from("promotions")
    .insert({
      promotion_id: randomUUID(),
      type: parsed.type,
      payload: parsed.payload,
      applies_to_sku_ids: parsed.applies_to_sku_ids.length > 0 ? parsed.applies_to_sku_ids : null,
      store_id: parsed.store_id,
      effective_from: parsed.effective_from,
      effective_to: parsed.effective_to,
      is_active: parsed.is_active,
    })
    .select("*")
    .single();

  if (result.error !== null) {
    throw new Error(`Failed to create promotion: ${result.error.message}`);
  }

  const promotion = result.data as Promotion;
  return promotion;
}

export async function updatePromotion(supabase: SupabaseClient, promotionId: string, input: PromotionInput): Promise<Promotion> {
  const parsed = PromotionInputSchema.parse(input);

  const result = await supabase
    .from("promotions")
    .update({
      type: parsed.type,
      payload: parsed.payload,
      applies_to_sku_ids: parsed.applies_to_sku_ids.length > 0 ? parsed.applies_to_sku_ids : null,
      store_id: parsed.store_id,
      effective_from: parsed.effective_from,
      effective_to: parsed.effective_to,
      is_active: parsed.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("promotion_id", promotionId)
    .select("*")
    .single();

  if (result.error !== null) {
    throw new Error(`Failed to update promotion: ${result.error.message}`);
  }

  const promotion = result.data as Promotion;
  return promotion;
}

export async function setPromotionActive(supabase: SupabaseClient, promotionId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("promotions")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("promotion_id", promotionId);

  if (error !== null) {
    throw new Error(`Failed to update promotion status: ${error.message}`);
  }
}
