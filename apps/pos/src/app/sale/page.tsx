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
import { discardParkedSale, listParkedSales, parkSale, resumeParkedSale, type ParkedSaleSummary } from "../../lib/cart/parked";
import { filterBrowseItems, loadBrowseCatalog, type BrowseCatalog, type SellableSku } from "../../lib/catalog/browse";
import { SupervisorPinDialog } from "../../components/supervisor-pin-dialog";
import { ProductBrowser } from "../../components/sale/product-browser";
import { CartPanel } from "../../components/sale/cart-panel";
import { PaymentSheet, type TenderMethod } from "../../components/sale/payment-sheet";
import { HeldSalesSheet } from "../../components/sale/held-sales-sheet";

type PendingAction =
  | { type: "void_item"; lineId: string }
  | { type: "void_sale" }
  | { type: "suspend" }
  | { type: "discard_held"; parkedSaleId: string };

const PENDING_ACTION_TITLES: Record<PendingAction["type"], string> = {
  void_item: "Authorize void item",
  void_sale: "Authorize void sale",
  suspend: "Authorize hold sale",
  discard_held: "Authorize discard held sale",
};

export default function SalePage() {
  const db = useDb();
  const router = useRouter();
  const cartStore = useMemo(() => new CartStore(), []);

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<ShiftRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<BrowseCatalog>({ categories: [], items: [] });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const [cartState, setCartState] = useState<CartState>(() => cartStore.getState());
  const [skuNames, setSkuNames] = useState<Record<string, string>>({});
  const [codeInput, setCodeInput] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [tenderMethod, setTenderMethod] = useState<TenderMethod>("cash");
  const [tenderAmountInput, setTenderAmountInput] = useState("");
  const [tenderReferenceInput, setTenderReferenceInput] = useState("");
  const [tenderError, setTenderError] = useState<string | null>(null);
  const [lastChangeDue, setLastChangeDue] = useState<number | null>(null);

  const [completedSale, setCompletedSale] = useState<SaleEvent | null>(null);
  const [completing, setCompleting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heldOpen, setHeldOpen] = useState(false);
  const [heldSales, setHeldSales] = useState<ParkedSaleSummary[]>([]);
  const [heldLoading, setHeldLoading] = useState(false);
  const [heldError, setHeldError] = useState<string | null>(null);
  const [heldBusy, setHeldBusy] = useState(false);

  // Manager-override gate (supervisor PIN) — void item/void sale/hold/discard
  // all route through here instead of running directly off a click.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

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

  const loadCatalog = useCallback(
    async (storeId: string) => {
      setCatalogLoading(true);
      try {
        setCatalog(await loadBrowseCatalog(db, { storeId, atTime: new Date().toISOString() }));
        setCatalogError(null);
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : String(err));
      } finally {
        setCatalogLoading(false);
      }
    },
    [db],
  );

  const loadHeldSales = useCallback(
    async (forTillId: string) => {
      setHeldLoading(true);
      try {
        setHeldSales(await listParkedSales(db, forTillId));
        setHeldError(null);
      } catch (err) {
        setHeldError(err instanceof Error ? err.message : String(err));
      } finally {
        setHeldLoading(false);
      }
    },
    [db],
  );

  const storeId = session?.store_id ?? null;

  useEffect(() => {
    if (storeId !== null && openShift) void loadCatalog(storeId);
  }, [storeId, openShift, loadCatalog]);

  useEffect(() => {
    if (tillId !== null && openShift) void loadHeldSales(tillId);
  }, [tillId, openShift, loadHeldSales]);

  const catalogNames = useMemo(() => new Map(catalog.items.map((item) => [item.sku.sku_id, item.sku.name])), [catalog.items]);
  const nameFor = useCallback(
    (skuId: string) => skuNames[skuId] ?? catalogNames.get(skuId) ?? skuId,
    [skuNames, catalogNames],
  );

  const visibleItems = useMemo(
    () => filterBrowseItems(catalog.items, { categoryId: activeCategoryId, search: codeInput }),
    [catalog.items, activeCategoryId, codeInput],
  );

  const refreshPromotions = useCallback(
    async (forStoreId: string) => {
      const state = cartStore.getState();
      const atTime = new Date().toISOString();
      const distinctSkuIds = [...new Set(state.lines.map((line) => line.skuId))];

      const matchesBySkuId = await Promise.all(
        distinctSkuIds.map((skuId) => findActivePromotions(db, { storeId: forStoreId, skuId, atTime })),
      );
      const merged = new Map<string, Promotion>();
      for (const matches of matchesBySkuId) {
        for (const promotion of matches) merged.set(promotion.promotionId, promotion);
      }
      cartStore.applyPromotions([...merged.values()]);
    },
    [cartStore, db],
  );

  /** Shared add path for scans, typed codes and product tiles. Returns false when the SKU has no active price. */
  async function addSku(sku: SkuRow, forStoreId: string): Promise<boolean> {
    const priceVersion = await resolvePrice(db, {
      skuId: sku.sku_id,
      storeId: forStoreId,
      atTime: new Date().toISOString(),
    });
    if (priceVersion === null) {
      setLookupError(`No active price for ${sku.name}.`);
      return false;
    }

    const existingLine =
      sku.unit_type === "quantity"
        ? cartStore
            .getState()
            .lines.find((line) => line.skuId === sku.sku_id && line.priceVersionId === priceVersion.price_version_id)
        : undefined;
    if (existingLine !== undefined) {
      cartStore.updateLineQty(existingLine.lineId, existingLine.qty + 1);
    } else {
      cartStore.addLine({
        skuId: sku.sku_id,
        unitType: sku.unit_type,
        qty: 1,
        unitPrice: priceVersion.unit_price,
        priceVersionId: priceVersion.price_version_id,
      });
    }
    setSkuNames((current) => ({ ...current, [sku.sku_id]: sku.name }));
    await refreshPromotions(forStoreId);
    return true;
  }

  async function handleAddByCode(): Promise<void> {
    const code = codeInput.trim();
    if (code.length === 0 || storeId === null) return;

    setAdding(true);
    setLookupError(null);
    try {
      let sku: SkuRow | null = (await findSkuByBarcode(db, code)) ?? (await findSkuByCode(db, code));
      if (sku === null) {
        // Fall back to the search box behaviour: a single name match is unambiguous enough to add.
        const nameMatches = visibleItems.filter((item) => item.price !== null);
        sku = nameMatches.length === 1 ? (nameMatches[0]?.sku ?? null) : null;
      }
      if (sku === null) {
        setLookupError(`No SKU found for "${code}".`);
        return;
      }

      if (await addSku(sku, storeId)) setCodeInput("");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handlePickItem(item: SellableSku): Promise<void> {
    if (storeId === null) return;
    setAdding(true);
    setLookupError(null);
    try {
      await addSku(item.sku, storeId);
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
    if (storeId !== null) void refreshPromotions(storeId);
  }

  function handleRemoveLine(lineId: string): void {
    cartStore.removeLine(lineId);
    if (storeId !== null) void refreshPromotions(storeId);
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
      void loadCatalog(session.store_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompleting(false);
    }
  }

  async function handleSuspendSale(): Promise<void> {
    if (session === null || tillId === null || session.store_id === null) return;

    setSuspending(true);
    setError(null);
    try {
      await parkSale(db, {
        tillId,
        storeId: session.store_id,
        cashierId: session.user_id,
        cart: cartState,
      });
      cartStore.clear();
      setTenders([]);
      setLastChangeDue(null);
      void loadHeldSales(tillId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuspending(false);
    }
  }

  async function handleResumeHeld(parkedSaleId: string): Promise<void> {
    if (tillId === null) return;
    if (cartState.lines.length > 0) {
      setHeldError("Hold or clear the current sale first.");
      return;
    }

    setHeldBusy(true);
    setHeldError(null);
    try {
      const restored = await resumeParkedSale(db, parkedSaleId);
      cartStore.restore(restored);
      setTenders([]);
      setLastChangeDue(null);
      setHeldOpen(false);
      if (storeId !== null) await refreshPromotions(storeId);
      void loadHeldSales(tillId);
    } catch (err) {
      setHeldError(err instanceof Error ? err.message : String(err));
    } finally {
      setHeldBusy(false);
    }
  }

  async function handleDiscardHeld(parkedSaleId: string): Promise<void> {
    if (tillId === null) return;
    setHeldBusy(true);
    setHeldError(null);
    try {
      await discardParkedSale(db, parkedSaleId);
      await loadHeldSales(tillId);
    } catch (err) {
      setHeldError(err instanceof Error ? err.message : String(err));
    } finally {
      setHeldBusy(false);
    }
  }

  function handleSupervisorApproved(): void {
    const action = pendingAction;
    setPendingAction(null);
    if (action === null) return;
    if (action.type === "void_item") handleRemoveLine(action.lineId);
    else if (action.type === "void_sale") void handleVoidLastSale();
    else if (action.type === "discard_held") void handleDiscardHeld(action.parkedSaleId);
    else void handleSuspendSale();
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
      if (session.store_id !== null) void loadCatalog(session.store_id);
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
        skuName: nameFor(item.sku_id),
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

  function handleNewSale(): void {
    setCompletedSale(null);
    setLastChangeDue(null);
    setError(null);
    setTenderError(null);
    setPaymentOpen(false);
  }

  function handlePaymentOpenChange(open: boolean): void {
    if (open) {
      setPaymentOpen(true);
      return;
    }
    // Closing the receipt is the same as starting a new sale; closing mid-payment keeps captured tenders.
    if (completedSale !== null) handleNewSale();
    else setPaymentOpen(false);
  }

  if (openShift === undefined) return null;

  return (
    <main className="flex flex-col gap-3 p-3.5 min-[900px]:grid min-[900px]:h-[calc(100vh-3.5rem)] min-[900px]:grid-cols-[1fr_410px]">
      {loadError !== null && (
        <p className="text-body-md text-destructive min-[900px]:col-span-2">Could not load till state: {loadError}</p>
      )}

      <ProductBrowser
        codeInput={codeInput}
        onCodeInputChange={(value) => {
          setCodeInput(value);
          setLookupError(null);
        }}
        onSubmitCode={() => void handleAddByCode()}
        adding={adding}
        lookupError={lookupError}
        categories={catalog.categories}
        activeCategoryId={activeCategoryId}
        onCategoryChange={setActiveCategoryId}
        items={visibleItems}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onPick={(item) => void handlePickItem(item)}
      />

      <CartPanel
        cart={cartState}
        nameFor={nameFor}
        onQtyChange={handleQtyChange}
        onRemoveLine={(lineId) => setPendingAction({ type: "void_item", lineId })}
        onHold={() => setPendingAction({ type: "suspend" })}
        holding={suspending}
        heldCount={heldSales.length}
        onShowHeld={() => {
          setHeldError(null);
          setHeldOpen(true);
          if (tillId !== null) void loadHeldSales(tillId);
        }}
        onPay={() => {
          setError(null);
          setPaymentOpen(true);
        }}
        error={paymentOpen ? null : error}
      />

      <PaymentSheet
        open={paymentOpen}
        onOpenChange={handlePaymentOpenChange}
        grandTotal={cartState.grandTotal}
        remaining={remaining}
        tenders={tenders}
        tenderedTotal={sumTenderAmounts(tenders)}
        tenderMethod={tenderMethod}
        onTenderMethodChange={(method) => {
          setTenderMethod(method);
          setTenderError(null);
        }}
        amountInput={tenderAmountInput}
        onAmountInputChange={setTenderAmountInput}
        referenceInput={tenderReferenceInput}
        onReferenceInputChange={setTenderReferenceInput}
        onAddTender={handleAddTender}
        onCardTender={() => void handleCardTender()}
        onClearTenders={handleClearTenders}
        tenderError={tenderError}
        lastChangeDue={lastChangeDue}
        error={error}
        completing={completing}
        canComplete={cartState.lines.length > 0 && remaining <= 0.01}
        onComplete={() => void handleCompleteSale()}
        completedSale={completedSale}
        nameFor={nameFor}
        voiding={voiding}
        onDownloadReceipt={handleDownloadReceipt}
        onVoidSale={() => setPendingAction({ type: "void_sale" })}
        onNewSale={handleNewSale}
      />

      <HeldSalesSheet
        open={heldOpen}
        onOpenChange={setHeldOpen}
        heldSales={heldSales}
        loading={heldLoading}
        error={heldError}
        busy={heldBusy}
        onResume={(parkedSaleId) => void handleResumeHeld(parkedSaleId)}
        onDiscard={(parkedSaleId) => setPendingAction({ type: "discard_held", parkedSaleId })}
      />

      {pendingAction !== null && (
        <SupervisorPinDialog
          db={db}
          title={PENDING_ACTION_TITLES[pendingAction.type]}
          onCancel={() => setPendingAction(null)}
          onApproved={handleSupervisorApproved}
        />
      )}
    </main>
  );
}
