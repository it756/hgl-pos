"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SaleEvent } from "@hgl/events";
import { useDb } from "../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../lib/auth/cashier-session";
import type { ShiftRow } from "../../lib/events/queue";
import { createSaleEventQueue, createShiftEventQueue, createVoidEventQueue, getTillId } from "../../lib/till/services";
import { findSkuByBarcode, findSkuByCode, type SkuRow } from "../../lib/pricing/lookup";
import { resolvePrice } from "../../lib/pricing/resolve";
import { findActivePromotions, type Promotion } from "../../lib/pricing/promotions";
import { CartStore, type CartState } from "../../lib/cart/store";
import { buildCashTender, calculateChangeDue } from "../../lib/tenders/cash";
import { readCardFromReader } from "../../lib/tenders/card";
import { buildMobileMoneyMtnTender } from "../../lib/tenders/mobile-money-mtn";
import { buildMobileMoneyAirtelTender } from "../../lib/tenders/mobile-money-airtel";
import { remainingBalance, sumTenderAmounts, type Tender } from "../../lib/tenders/types";
import { renderDigitalReceiptPdf, type ReceiptData } from "../../lib/peripherals/receipt";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";

type TenderMethod = "cash" | "card" | "mobile_money_mtn" | "mobile_money_airtel";

export default function SalePage() {
  const db = useDb();
  const router = useRouter();
  const cartStore = useMemo(() => new CartStore(), []);

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<ShiftRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cartState, setCartState] = useState<CartState>(() => cartStore.getState());
  const [skuNames, setSkuNames] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderMethod, setTenderMethod] = useState<TenderMethod>("cash");
  const [tenderAmountInput, setTenderAmountInput] = useState("");
  const [tenderReferenceInput, setTenderReferenceInput] = useState("");
  const [tenderError, setTenderError] = useState<string | null>(null);
  const [lastChangeDue, setLastChangeDue] = useState<number | null>(null);

  const [completedSale, setCompletedSale] = useState<SaleEvent | null>(null);
  const [completing, setCompleting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => cartStore.subscribe(setCartState), [cartStore]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const sessionManager = new CashierSessionManager({ db });
        const current = await sessionManager.getCurrentSession();
        if (cancelled) return;
        if (current === null) {
          router.replace("/login");
          return;
        }
        setSession(current);

        const resolvedTillId = await getTillId(db);
        if (cancelled) return;
        setTillId(resolvedTillId);

        if (resolvedTillId === null || current.store_id === null) {
          setOpenShift(null);
          return;
        }

        const shiftQueue = createShiftEventQueue(db, resolvedTillId, current.store_id);
        const shift = await shiftQueue.getOpenShift();
        if (cancelled) return;
        if (shift === null) {
          router.replace("/shift/open");
          return;
        }
        setOpenShift(shift);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  const refreshPromotions = useCallback(
    async (storeId: string) => {
      const state = cartStore.getState();
      const atTime = new Date().toISOString();
      const distinctSkuIds = [...new Set(state.lines.map((line) => line.skuId))];

      const matchesBySkuId = await Promise.all(
        distinctSkuIds.map((skuId) => findActivePromotions(db, { storeId, skuId, atTime })),
      );
      const merged = new Map<string, Promotion>();
      for (const matches of matchesBySkuId) {
        for (const promotion of matches) merged.set(promotion.promotionId, promotion);
      }
      cartStore.applyPromotions([...merged.values()]);
    },
    [cartStore, db],
  );

  async function handleAddByCode(): Promise<void> {
    const code = codeInput.trim();
    if (code.length === 0 || session === null || session.store_id === null) return;

    setAdding(true);
    setLookupError(null);
    try {
      const sku: SkuRow | null = (await findSkuByBarcode(db, code)) ?? (await findSkuByCode(db, code));
      if (sku === null) {
        setLookupError(`No SKU found for "${code}".`);
        return;
      }

      const priceVersion = await resolvePrice(db, {
        skuId: sku.sku_id,
        storeId: session.store_id,
        atTime: new Date().toISOString(),
      });
      if (priceVersion === null) {
        setLookupError(`No active price for ${sku.name}.`);
        return;
      }

      cartStore.addLine({
        skuId: sku.sku_id,
        unitType: sku.unit_type,
        qty: 1,
        unitPrice: priceVersion.unit_price,
        priceVersionId: priceVersion.price_version_id,
      });
      setSkuNames((current) => ({ ...current, [sku.sku_id]: sku.name }));
      await refreshPromotions(session.store_id);
      setCodeInput("");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  function handleQtyChange(lineId: string, delta: number): void {
    const line = cartState.lines.find((candidate) => candidate.lineId === lineId);
    if (line === undefined) return;
    const step = line.unitType === "weight" ? 0.1 : 1;
    cartStore.updateLineQty(lineId, Math.max(0, line.qty + delta * step));
    if (session?.store_id != null) void refreshPromotions(session.store_id);
  }

  function handleRemoveLine(lineId: string): void {
    cartStore.removeLine(lineId);
    if (session?.store_id != null) void refreshPromotions(session.store_id);
  }

  const remaining = remainingBalance(cartState.grandTotal, tenders);

  function handleAddTender(): void {
    setTenderError(null);
    setLastChangeDue(null);

    const amount = Number(tenderAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setTenderError("Enter a valid amount.");
      return;
    }

    if (tenderMethod === "cash") {
      const applied = Math.min(amount, remaining);
      const change = calculateChangeDue(amount, applied);
      setTenders((current) => [...current, buildCashTender(Math.round(applied * 100) / 100)]);
      setLastChangeDue(change > 0 ? change : null);
    } else if (tenderMethod === "mobile_money_mtn" || tenderMethod === "mobile_money_airtel") {
      if (tenderReferenceInput.trim().length === 0) {
        setTenderError("Enter the mobile money reference.");
        return;
      }
      const applied = Math.round(Math.min(amount, remaining) * 100) / 100;
      const tender =
        tenderMethod === "mobile_money_mtn"
          ? buildMobileMoneyMtnTender(applied, tenderReferenceInput.trim())
          : buildMobileMoneyAirtelTender(applied, tenderReferenceInput.trim());
      setTenders((current) => [...current, tender]);
    }

    setTenderAmountInput("");
    setTenderReferenceInput("");
  }

  async function handleCardTender(): Promise<void> {
    setTenderError(null);
    try {
      await readCardFromReader();
    } catch (err) {
      setTenderError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleClearTenders(): void {
    setTenders([]);
    setTenderError(null);
    setLastChangeDue(null);
  }

  async function handleCompleteSale(): Promise<void> {
    if (session?.store_id == null || tillId === null || openShift === null || openShift === undefined) return;
    if (remaining > 0.01) {
      setError("Sale is not fully tendered yet.");
      return;
    }

    setCompleting(true);
    setError(null);
    try {
      const queue = createSaleEventQueue(db, tillId, session.store_id);
      const event = await queue.completeSale({
        cashierId: session.user_id,
        shiftId: openShift.shift_id,
        cart: cartState,
        tenders,
      });
      setCompletedSale(event);
      cartStore.clear();
      setTenders([]);
      setLastChangeDue(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompleting(false);
    }
  }

  async function handleVoidLastSale(): Promise<void> {
    if (completedSale === null || session === null || tillId === null || openShift === null || openShift === undefined) return;

    setVoiding(true);
    setError(null);
    try {
      const queue = createVoidEventQueue(db, tillId, session.store_id ?? "");
      const voidEvent = await queue.voidSale({
        saleId: completedSale.sale_id,
        cashierId: session.user_id,
        shiftId: openShift.shift_id,
      });
      setCompletedSale(voidEvent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiding(false);
    }
  }

  function handleDownloadReceipt(): void {
    if (completedSale === null || session === null) return;

    const data: ReceiptData = {
      storeName: "Harvest Group",
      tillLabel: tillId ?? "",
      cashierName: session.full_name,
      saleId: completedSale.sale_id,
      clientTs: completedSale.client_ts,
      status: completedSale.status,
      items: completedSale.items.map((item) => ({
        skuName: skuNames[item.sku_id] ?? item.sku_id,
        qty: item.qty,
        unitPrice: item.unit_price,
        lineDiscount: item.line_discount,
        lineTotal: item.line_total,
      })),
      subtotal: completedSale.subtotal,
      discountTotal: completedSale.discount_total,
      taxTotal: completedSale.tax_total,
      grandTotal: completedSale.grand_total,
      tenders: completedSale.tenders,
    };

    const blob = new Blob([renderDigitalReceiptPdf(data) as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt-${completedSale.sale_id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (openShift === undefined) return null;

  if (completedSale !== null) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center p-md">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Sale {completedSale.status === "completed" ? "complete" : "voided"}
              <Badge variant={completedSale.status === "completed" ? "success" : "destructive"}>
                {completedSale.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-md">
            <p className="text-body-md font-body-md text-on-surface-variant">Sale ID: {completedSale.sale_id}</p>
            <p className="text-headline-md font-headline-md text-on-surface">{completedSale.grand_total.toFixed(2)} ZMW</p>
            {lastChangeDue !== null && (
              <p className="text-body-md font-body-md text-on-surface-variant">Change given: {lastChangeDue.toFixed(2)} ZMW</p>
            )}

            {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

            <Button type="button" size="lg" onClick={handleDownloadReceipt}>
              Download receipt (PDF)
            </Button>

            {completedSale.status === "completed" && (
              <Button type="button" size="lg" variant="destructive" disabled={voiding} onClick={() => void handleVoidLastSale()}>
                {voiding ? "Voiding…" : "Void this sale"}
              </Button>
            )}

            <Button type="button" size="lg" variant="outline" onClick={() => setCompletedSale(null)}>
              New sale
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl flex-col gap-md p-md">
      {loadError !== null && <p className="text-body-md font-body-md text-destructive">Could not load till state: {loadError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Scan or enter a code</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-sm">
          <div className="flex gap-2">
            <input
              autoFocus
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAddByCode();
              }}
              placeholder="Barcode or SKU code"
              className="h-12 flex-1 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
            />
            <Button type="button" size="lg" disabled={adding} onClick={() => void handleAddByCode()}>
              Add
            </Button>
          </div>
          {lookupError !== null && <p className="text-body-md font-body-md text-destructive">{lookupError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cart</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-sm">
          {cartState.lines.length === 0 && (
            <p className="text-body-md font-body-md text-on-surface-variant">No items yet.</p>
          )}
          {cartState.lines.map((line) => (
            <div key={line.lineId} className="flex items-center justify-between gap-2 border-b border-outline-variant pb-2">
              <div className="flex flex-col">
                <span className="text-body-md font-body-md text-on-surface">{skuNames[line.skuId] ?? line.skuId}</span>
                <span className="text-label-sm font-label-sm text-on-surface-variant">
                  {line.qty} x {line.unitPrice.toFixed(2)}
                  {line.promotionId !== null && " · promo applied"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => handleQtyChange(line.lineId, -1)}>
                  −
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => handleQtyChange(line.lineId, 1)}>
                  +
                </Button>
                <span className="w-20 text-right text-body-md font-body-md text-on-surface">{line.lineTotal.toFixed(2)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveLine(line.lineId)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}

          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-body-md font-body-md">
            <dt className="text-on-surface-variant">Subtotal</dt>
            <dd className="text-right text-on-surface">{cartState.subtotal.toFixed(2)}</dd>
            <dt className="text-on-surface-variant">Discount</dt>
            <dd className="text-right text-on-surface">-{cartState.discountTotal.toFixed(2)}</dd>
            <dt className="font-semibold text-on-surface">Total</dt>
            <dd className="text-right font-semibold text-on-surface">{cartState.grandTotal.toFixed(2)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tender</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-sm">
          <p className="text-body-md font-body-md text-on-surface-variant">Remaining: {remaining.toFixed(2)} ZMW</p>

          {tenders.length > 0 && (
            <ul className="flex flex-col gap-1 text-body-md font-body-md text-on-surface-variant">
              {tenders.map((tender, index) => (
                <li key={index}>
                  {tender.type}: {tender.amount.toFixed(2)}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            {(["cash", "card", "mobile_money_mtn", "mobile_money_airtel"] as const).map((method) => (
              <Button
                key={method}
                type="button"
                variant={tenderMethod === method ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setTenderMethod(method);
                  setTenderError(null);
                }}
              >
                {method === "cash" && "Cash"}
                {method === "card" && "Card"}
                {method === "mobile_money_mtn" && "MTN"}
                {method === "mobile_money_airtel" && "Airtel"}
              </Button>
            ))}
          </div>

          {tenderMethod === "card" ? (
            <Button type="button" size="lg" onClick={() => void handleCardTender()}>
              Tender with card
            </Button>
          ) : (
            <div className="flex flex-col gap-sm">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={tenderAmountInput}
                onChange={(event) => setTenderAmountInput(event.target.value)}
                placeholder={`Amount (${remaining.toFixed(2)})`}
                className="h-12 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
              />
              {tenderMethod !== "cash" && (
                <input
                  value={tenderReferenceInput}
                  onChange={(event) => setTenderReferenceInput(event.target.value)}
                  placeholder="Mobile money reference"
                  className="h-12 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                />
              )}
              <Button type="button" size="lg" onClick={handleAddTender}>
                Add tender
              </Button>
            </div>
          )}

          {tenderError !== null && <p className="text-body-md font-body-md text-destructive">{tenderError}</p>}
          {lastChangeDue !== null && (
            <p className="text-body-md font-body-md text-on-surface-variant">Change due: {lastChangeDue.toFixed(2)} ZMW</p>
          )}

          {tenders.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClearTenders}>
              Clear tenders
            </Button>
          )}

          {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

          <Button
            type="button"
            size="lg"
            disabled={completing || cartState.lines.length === 0 || remaining > 0.01}
            onClick={() => void handleCompleteSale()}
          >
            {completing ? "Completing sale…" : `Complete sale — ${sumTenderAmounts(tenders).toFixed(2)} tendered`}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
