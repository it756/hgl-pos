"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchTransfer, requestTransfer, type TransferLineItemInput } from "../lib/events/transfer";
import type { SkuOption, StoreOption } from "../lib/catalog/options";
import type { StoreStockRow } from "../lib/warehouse/service";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type WarehouseDashboardProps = {
  stock: StoreStockRow[];
  skus: SkuOption[];
  stores: StoreOption[];
  currentUserId: string;
  currentStoreId: string | null;
  role: "hq_admin" | "store_manager" | "cashier" | "device" | null;
};

export function WarehouseDashboard({ stock, skus, stores, currentUserId, currentStoreId, role }: WarehouseDashboardProps) {
  const router = useRouter();
  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);

  const [selectedStoreId, setSelectedStoreId] = useState(currentStoreId ?? stores[0]?.store_id ?? "");
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => stock.filter((row) => row.store_id === selectedStoreId), [stock, selectedStoreId]);
  const canReplenish = role === "store_manager" && currentStoreId !== null && selectedStoreId === currentStoreId;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Warehouse</h1>
        <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface-variant">
          Store
          <select
            value={selectedStoreId}
            onChange={(event) => setSelectedStoreId(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
          >
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-body-md font-body-md text-on-surface-variant">
        Any store can act as a central warehouse and dispatch replenishment to others — it uses the exact same transfer event
        model as a regular store-to-store transfer (FR-015).
      </p>

      {error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stock on hand ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Qty on hand</TableHead>
                <TableHead>In transit out</TableHead>
                <TableHead>In transit in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.sku_id}>
                  <TableCell>{skuById.get(row.sku_id)?.name ?? row.sku_id}</TableCell>
                  <TableCell>
                    <Badge variant={row.qty_on_hand < 0 ? "destructive" : "default"}>{row.qty_on_hand}</Badge>
                  </TableCell>
                  <TableCell>{row.qty_in_transit_out}</TableCell>
                  <TableCell>{row.qty_in_transit_in}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No stock data visible for this store.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canReplenish && (
        <ReplenishmentForm
          sourceStoreId={selectedStoreId}
          stores={stores}
          skus={skus}
          currentUserId={currentUserId}
          onDone={() => router.refresh()}
          onError={setError}
        />
      )}
    </div>
  );
}

type LineItemRow = { sku_id: string; qty: string };

type ReplenishmentFormProps = {
  sourceStoreId: string;
  stores: StoreOption[];
  skus: SkuOption[];
  currentUserId: string;
  onDone: () => void;
  onError: (message: string) => void;
};

// Warehouse-initiated replenishment combines request + dispatch into one
// action (the warehouse ships as soon as it decides to, unlike a regular
// store-to-store transfer which waits on a separate dispatch confirmation)
// — but this still writes two distinct, immutable transfer_events rows via
// the same builders the Transfers page uses (FR-015: same event model).
function ReplenishmentForm({ sourceStoreId, stores, skus, currentUserId, onDone, onError }: ReplenishmentFormProps) {
  const destinationOptions = stores.filter((store) => store.store_id !== sourceStoreId);
  const [destinationStoreId, setDestinationStoreId] = useState(destinationOptions[0]?.store_id ?? "");
  const [rows, setRows] = useState<LineItemRow[]>([{ sku_id: skus[0]?.sku_id ?? "", qty: "" }]);
  const [submitting, setSubmitting] = useState(false);

  function updateRow(index: number, patch: Partial<LineItemRow>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((current) => [...current, { sku_id: skus[0]?.sku_id ?? "", qty: "" }]);
  }
  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  async function handleSubmit() {
    const lineItems: TransferLineItemInput[] = rows
      .filter((row) => row.sku_id !== "" && row.qty.trim() !== "")
      .map((row) => ({ sku_id: row.sku_id, qty: Number(row.qty) }));

    if (destinationStoreId === "" || lineItems.length === 0) {
      onError("Destination store and at least one line item are required.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { transfer_id } = await requestTransfer(supabase, currentUserId, {
        sourceStoreId,
        destinationStoreId,
        lineItems,
      });
      await dispatchTransfer(
        supabase,
        currentUserId,
        { transfer_id, source_store_id: sourceStoreId, destination_store_id: destinationStoreId },
        lineItems,
      );
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send replenishment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wh-destination-store">Destination store</Label>
          <select
            id="wh-destination-store"
            value={destinationStoreId}
            onChange={(event) => setDestinationStoreId(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
          >
            {destinationOptions.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor={`wh-sku-${index}`}>SKU</Label>
                <select
                  id={`wh-sku-${index}`}
                  value={row.sku_id}
                  onChange={(event) => updateRow(index, { sku_id: event.target.value })}
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
                >
                  {skus.map((sku) => (
                    <option key={sku.sku_id} value={sku.sku_id}>
                      {sku.code} — {sku.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-24 flex-col gap-1">
                <Label htmlFor={`wh-qty-${index}`}>Qty</Label>
                <Input
                  id={`wh-qty-${index}`}
                  type="number"
                  min="0"
                  step="0.001"
                  value={row.qty}
                  onChange={(event) => updateRow(index, { qty: event.target.value })}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            Add line
          </Button>
        </div>

        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Sending…" : "Request & dispatch now"}
        </Button>
      </CardContent>
    </Card>
  );
}
