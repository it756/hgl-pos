"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { savePromotion, togglePromotionActive, type PromotionFormState } from "../../app/(app)/promotions/actions";
import type { Promotion, PromotionType } from "../../lib/promotions/promotions";
import type { SkuOption, StoreOption } from "../../lib/catalog/options";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

export type PromotionsViewProps = {
  skus: SkuOption[];
  stores: StoreOption[];
  promotions: Promotion[];
  loyaltyTiers: { code: string; name: string }[];
};

const initialState: PromotionFormState = { error: null, success: false };

const TYPE_LABELS: Record<PromotionType, string> = {
  date_range_discount: "Date-range discount",
  bogo: "Buy-one-get-one",
  bundle: "Bundle",
  loyalty_tier: "Loyalty tier",
};

export function PromotionsView({ skus, stores, promotions, loyaltyTiers }: PromotionsViewProps) {
  const [state, formAction, pending] = useActionState(savePromotion, initialState);
  const [, startToggleTransition] = useTransition();
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [type, setType] = useState<PromotionType>("date_range_discount");
  const [storeId, setStoreId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [appliesToSkuIds, setAppliesToSkuIds] = useState<string[]>([]);
  const [discountPct, setDiscountPct] = useState("10");
  const [buyQty, setBuyQty] = useState("1");
  const [getQty, setGetQty] = useState("1");
  const [tier, setTier] = useState("");
  const [bundlePrice, setBundlePrice] = useState("0");

  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  useEffect(() => {
    if (!state.success) return;
    resetForm();
  }, [state.success]);

  function resetForm() {
    setEditing(null);
    setType("date_range_discount");
    setStoreId("");
    setEffectiveFrom("");
    setEffectiveTo("");
    setIsActive(true);
    setAppliesToSkuIds([]);
    setDiscountPct("10");
    setBuyQty("1");
    setGetQty("1");
    setTier("");
    setBundlePrice("0");
  }

  function startEdit(promotion: Promotion) {
    setEditing(promotion);
    setType(promotion.type);
    setStoreId(promotion.store_id ?? "");
    setEffectiveFrom(toLocalInputValue(promotion.effective_from));
    setEffectiveTo(toLocalInputValue(promotion.effective_to));
    setIsActive(promotion.is_active);
    setAppliesToSkuIds(promotion.applies_to_sku_ids ?? []);

    const payload = promotion.payload;
    setDiscountPct(readPayloadString(payload, "discount_pct", "10"));
    setBuyQty(readPayloadString(payload, "buy", "1"));
    setGetQty(readPayloadString(payload, "get", "1"));
    setTier(readPayloadString(payload, "tier", ""));
    setBundlePrice(readPayloadString(payload, "bundle_price", "0"));
  }

  const payload = useMemo(() => {
    switch (type) {
      case "date_range_discount":
        return { discount_pct: Number(discountPct) };
      case "bogo":
        return { buy: Number(buyQty), get: Number(getQty), discount_pct: Number(discountPct) };
      case "bundle":
        return { bundle_sku_ids: appliesToSkuIds, bundle_price: Number(bundlePrice) };
      case "loyalty_tier":
        return { tier, discount_pct: Number(discountPct) };
      default:
        return {};
    }
  }, [type, discountPct, buyQty, getQty, tier, bundlePrice, appliesToSkuIds]);

  return (
    <div className="grid grid-cols-1 gap-md xl:grid-cols-[2fr_1fr]">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Promotions</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>SKUs</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {promotions.map((promotion) => (
              <TableRow key={promotion.promotion_id}>
                <TableCell>{TYPE_LABELS[promotion.type]}</TableCell>
                <TableCell>{describeSkus(promotion.applies_to_sku_ids, skuById)}</TableCell>
                <TableCell>
                  {promotion.store_id === null ? (
                    <Badge variant="secondary">Fleet-wide</Badge>
                  ) : (
                    (storeById.get(promotion.store_id)?.code ?? promotion.store_id)
                  )}
                </TableCell>
                <TableCell>
                  {promotion.effective_from !== null ? new Date(promotion.effective_from).toLocaleDateString() : "—"}
                  {" – "}
                  {promotion.effective_to !== null ? new Date(promotion.effective_to).toLocaleDateString() : "open"}
                </TableCell>
                <TableCell>
                  <Badge variant={promotion.is_active ? "success" : "outline"}>
                    {promotion.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(promotion)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        startToggleTransition(() => {
                          void togglePromotionActive(promotion.promotion_id, !promotion.is_active);
                        })
                      }
                    >
                      {promotion.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {promotions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-4 text-center text-on-surface-variant">
                  No promotions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{editing !== null ? "Edit promotion" : "New promotion"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-md">
            <input type="hidden" name="promotion_id" value={editing?.promotion_id ?? ""} />
            <input type="hidden" name="payload_json" value={JSON.stringify(payload)} readOnly />

            <div className="flex flex-col gap-1">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                name="type"
                value={type}
                onChange={(event) => setType(event.target.value as PromotionType)}
                className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {type === "bogo" && (
              <div className="grid grid-cols-2 gap-md">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="buy_qty">Buy</Label>
                  <Input id="buy_qty" type="number" min="1" value={buyQty} onChange={(event) => setBuyQty(event.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="get_qty">Get</Label>
                  <Input id="get_qty" type="number" min="1" value={getQty} onChange={(event) => setGetQty(event.target.value)} />
                </div>
              </div>
            )}

            {(type === "date_range_discount" || type === "bogo" || type === "loyalty_tier") && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="discount_pct">Discount %</Label>
                <Input
                  id="discount_pct"
                  type="number"
                  min="0"
                  max="100"
                  value={discountPct}
                  onChange={(event) => setDiscountPct(event.target.value)}
                />
              </div>
            )}

            {type === "loyalty_tier" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="tier">Loyalty tier</Label>
                <select
                  id="tier"
                  value={tier}
                  onChange={(event) => setTier(event.target.value)}
                  className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md text-on-surface"
                >
                  <option value="" disabled>
                    {loyaltyTiers.length === 0 ? "Create tiers under Customers first" : "Choose a tier"}
                  </option>
                  {loyaltyTiers.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name} ({option.code})
                    </option>
                  ))}
                  {tier !== "" && !loyaltyTiers.some((option) => option.code === tier) && <option value={tier}>{tier} (not a current tier)</option>}
                </select>
              </div>
            )}

            {type === "bundle" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="bundle_price">Bundle price (ZMW)</Label>
                <Input
                  id="bundle_price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={bundlePrice}
                  onChange={(event) => setBundlePrice(event.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="applies_to_sku_ids">{type === "bundle" ? "Bundle SKUs" : "Applies to SKUs (optional)"}</Label>
              <select
                id="applies_to_sku_ids"
                name="applies_to_sku_ids"
                multiple
                value={appliesToSkuIds}
                onChange={(event) => setAppliesToSkuIds([...event.target.selectedOptions].map((option) => option.value))}
                className="h-32 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md"
              >
                {skus.map((sku) => (
                  <option key={sku.sku_id} value={sku.sku_id}>
                    {sku.code} — {sku.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="store_id">Store scope</Label>
              <select
                id="store_id"
                name="store_id"
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
              >
                <option value="">Fleet-wide</option>
                {stores.map((store) => (
                  <option key={store.store_id} value={store.store_id}>
                    {store.code} — {store.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-md">
              <div className="flex flex-col gap-1">
                <Label htmlFor="effective_from">Effective from</Label>
                <Input
                  id="effective_from"
                  name="effective_from"
                  type="datetime-local"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="effective_to">Effective to</Label>
                <Input
                  id="effective_to"
                  name="effective_to"
                  type="datetime-local"
                  value={effectiveTo}
                  onChange={(event) => setEffectiveTo(event.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface">
              <input type="checkbox" name="is_active" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              Active
            </label>

            {state.error !== null && (
              <p role="alert" className="text-body-md font-body-md text-destructive">
                {state.error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : editing !== null ? "Save changes" : "Create promotion"}
              </Button>
              {editing !== null && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function toLocalInputValue(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeSkus(skuIds: string[] | null, skuById: Map<string, SkuOption>): string {
  if (skuIds === null || skuIds.length === 0) return "All SKUs";
  const codes = skuIds.map((id) => skuById.get(id)?.code ?? id);
  return codes.length > 2 ? `${codes.slice(0, 2).join(", ")} +${codes.length - 2}` : codes.join(", ");
}

function readPayloadString(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
