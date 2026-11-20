"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import type { CartState } from "../../lib/cart/store";
import { formatAmount, formatZmw } from "../../lib/format";
import { Button } from "../ui/button";

export type CartPanelProps = {
  cart: CartState;
  nameFor: (skuId: string) => string;
  onQtyChange: (lineId: string, delta: number) => void;
  onRemoveLine: (lineId: string) => void;
  onHold: () => void;
  holding: boolean;
  heldCount: number;
  onShowHeld: () => void;
  onPay: () => void;
  error: string | null;
};

export function CartPanel({
  cart,
  nameFor,
  onQtyChange,
  onRemoveLine,
  onHold,
  holding,
  heldCount,
  onShowHeld,
  onPay,
  error,
}: CartPanelProps) {
  const isEmpty = cart.lines.length === 0;
  const itemCount = cart.lines.reduce((sum, line) => sum + (line.unitType === "weight" ? 1 : line.qty), 0);

  return (
    <aside
      aria-label="Current sale"
      className="flex min-h-0 flex-col gap-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest p-3 min-[900px]:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body-lg font-semibold text-on-surface">Current sale</h2>
        <Button type="button" variant="outline" size="sm" onClick={onShowHeld}>
          Held ({heldCount})
        </Button>
      </div>

      <div className="min-h-[110px] flex-1 overflow-y-auto">
        {isEmpty ? (
          <p className="px-2.5 py-8 text-center text-body-md text-on-surface-variant">
            No items yet. Scan a barcode, enter a code or tap an item.
          </p>
        ) : (
          cart.lines.map((line) => (
            <div
              key={line.lineId}
              className="grid grid-cols-[1fr_auto_84px] items-center gap-2 border-b border-outline-variant py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-on-surface">{nameFor(line.skuId)}</p>
                <p className="text-label-sm text-on-surface-variant">
                  {formatAmount(line.unitPrice)} each
                  {line.promotionId !== null && " · promo applied"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-[34px] w-[34px]"
                  aria-label="Remove one"
                  onClick={() => onQtyChange(line.lineId, -1)}
                >
                  <Minus />
                </Button>
                <span className="min-w-8 text-center text-on-surface">
                  {line.unitType === "weight" ? line.qty.toFixed(2) : line.qty}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-[34px] w-[34px]"
                  aria-label="Add one"
                  onClick={() => onQtyChange(line.lineId, 1)}
                >
                  <Plus />
                </Button>
              </div>
              <span className="text-right font-semibold text-on-surface">{formatAmount(line.lineTotal)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="col-span-full min-h-8 justify-start text-label-sm"
                onClick={() => onRemoveLine(line.lineId)}
              >
                <Trash2 />
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      <dl className="flex flex-col gap-0.5 text-body-md">
        <div className="flex justify-between text-on-surface-variant">
          <dt>Items ({itemCount})</dt>
          <dd>{formatAmount(cart.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-on-surface-variant">
          <dt>Discount</dt>
          <dd>-{formatAmount(cart.discountTotal)}</dd>
        </div>
        <div className="flex justify-between pt-1.5 text-[22px] font-semibold leading-8 text-on-surface">
          <dt>Total</dt>
          <dd>{formatZmw(cart.grandTotal)}</dd>
        </div>
      </dl>

      {error !== null && <p className="text-body-md text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" className="flex-1" disabled={isEmpty || holding} onClick={onHold}>
          {holding ? "Holding…" : "Hold sale"}
        </Button>
      </div>

      <Button type="button" size="xl" disabled={isEmpty} onClick={onPay}>
        Pay {formatZmw(cart.grandTotal)}
      </Button>
    </aside>
  );
}
