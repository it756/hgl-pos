"use client";

import type { ParkedSaleSummary } from "../../lib/cart/parked";
import { Button } from "../ui/button";
import { Sheet, SheetContent } from "../ui/sheet";

export type HeldSalesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldSales: ParkedSaleSummary[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  onResume: (parkedSaleId: string) => void;
  onDiscard: (parkedSaleId: string) => void;
};

export function HeldSalesSheet({ open, onOpenChange, heldSales, loading, error, busy, onResume, onDiscard }: HeldSalesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Held sales"
        description="Held carts are not completed sales and do not change revenue or stock. They can only be resumed on this till."
      >
        {error !== null && <p className="text-body-md text-destructive">{error}</p>}
        {!loading && heldSales.length === 0 && (
          <p className="px-2.5 py-8 text-center text-body-md text-on-surface-variant">No held sales on this till.</p>
        )}
        <ul className="flex flex-col gap-2">
          {heldSales.map((held) => (
            <li
              key={held.parked_sale_id}
              className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-on-surface">{held.label ?? `Held ${held.parked_sale_id.slice(0, 8)}`}</span>
                <span className="text-label-sm text-on-surface-variant">{formatAge(held.parked_at)}</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" disabled={busy} onClick={() => onResume(held.parked_sale_id)}>
                  Resume
                </Button>
                <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => onDiscard(held.parked_sale_id)}>
                  Discard
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

function formatAge(iso: string): string {
  const parkedAt = new Date(iso);
  if (Number.isNaN(parkedAt.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - parkedAt.getTime()) / 60_000));
  const time = parkedAt.toTimeString().slice(0, 5);
  if (minutes < 1) return `${time}, just now`;
  if (minutes < 60) return `${time}, ${minutes} min ago`;
  return `${time}, ${Math.floor(minutes / 60)} h ago`;
}
