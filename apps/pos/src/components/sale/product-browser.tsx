"use client";

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { formatZmw } from "../../lib/format";
import type { CategoryRow, SellableSku } from "../../lib/catalog/browse";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const LOW_STOCK_THRESHOLD = 10;

export type ProductBrowserProps = {
  codeInput: string;
  onCodeInputChange: (value: string) => void;
  onSubmitCode: () => void;
  adding: boolean;
  lookupError: string | null;
  categories: CategoryRow[];
  activeCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  items: SellableSku[];
  catalogLoading: boolean;
  catalogError: string | null;
  onPick: (item: SellableSku) => void;
};

export function ProductBrowser({
  codeInput,
  onCodeInputChange,
  onSubmitCode,
  adding,
  lookupError,
  categories,
  activeCategoryId,
  onCategoryChange,
  items,
  catalogLoading,
  catalogError,
  onPick,
}: ProductBrowserProps) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 min-[900px]:min-h-0 min-[900px]:overflow-y-auto">
      <div className="flex gap-2">
        <Input
          autoFocus
          value={codeInput}
          onChange={(event) => onCodeInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmitCode();
          }}
          placeholder="Barcode or SKU code"
          aria-label="Scan a barcode, or search by code or name"
          autoComplete="off"
          className="min-h-12 text-body-lg"
        />
        <Button type="button" size="lg" className="min-h-12" disabled={adding} onClick={onSubmitCode}>
          Add
        </Button>
      </div>
      {lookupError !== null && <p className="text-body-md text-destructive">{lookupError}</p>}

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          <CategoryChip label="All" active={activeCategoryId === null} onClick={() => onCategoryChange(null)} />
          {categories.map((category) => (
            <CategoryChip
              key={category.category_id}
              label={category.name}
              active={activeCategoryId === category.category_id}
              onClick={() => onCategoryChange(category.category_id)}
            />
          ))}
        </div>
      )}

      {catalogError !== null && <p className="text-body-md text-destructive">Could not load products: {catalogError}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {items.map((item) => (
          <ProductTile key={item.sku.sku_id} item={item} disabled={adding} onPick={onPick} />
        ))}
      </div>

      {!catalogLoading && items.length === 0 && catalogError === null && (
        <p className="px-2.5 py-8 text-center text-body-md text-on-surface-variant">
          No items match. Check the entry or clear the category filter.
        </p>
      )}
    </section>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} aria-pressed={active} onClick={onClick}>
      {label}
    </Button>
  );
}

function ProductTile({ item, disabled, onPick }: { item: SellableSku; disabled: boolean; onPick: (item: SellableSku) => void }) {
  const noPrice = item.price === null;
  const qty = item.qtyOnHand;

  // Out-of-stock tiles stay sellable: offline oversell is an accepted, flagged flow (see us3-oversell).
  let stockChip: ReactNode = null;
  if (qty !== null && qty <= 0) stockChip = <Badge variant="destructive">Out</Badge>;
  else if (qty !== null && qty <= LOW_STOCK_THRESHOLD) stockChip = <Badge variant="warning">{formatQty(qty)} left</Badge>;

  return (
    <Button
      type="button"
      variant="tile"
      className={cn("gap-1.5 font-normal")}
      disabled={disabled || noPrice}
      onClick={() => onPick(item)}
    >
      <span className="line-clamp-2 font-semibold">{item.sku.name}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className={cn("whitespace-nowrap", noPrice && "text-on-surface-variant")}>
          {noPrice ? "No price" : formatZmw(item.price?.unit_price ?? 0)}
        </span>
        {stockChip}
      </span>
    </Button>
  );
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(1);
}
