"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  dispatchTransfer,
  receiveTransfer,
  requestTransfer,
  type PendingTransfer,
  type TransferLineItemInput,
} from "../lib/events/transfer";
import type { SkuOption, StoreOption } from "../lib/catalog/options";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type TransfersDashboardProps = {
  transfers: PendingTransfer[];
  requestedLineItemsByTransfer: Record<string, TransferLineItemInput[]>;
  skus: SkuOption[];
  stores: StoreOption[];
  currentUserId: string;
  currentStoreId: string | null;
  role: "hq_admin" | "store_manager" | "cashier" | "device" | null;
};

const STATE_LABEL: Record<PendingTransfer["state"], string> = {
  requested: "Requested",
  dispatched: "Dispatched",
  in_transit: "In transit",
  received: "Received",
  received_with_variance: "Received (variance)",
};

const STATE_BADGE_VARIANT: Record<PendingTransfer["state"], "secondary" | "default" | "success" | "warning"> = {
  requested: "secondary",
  dispatched: "default",
  in_transit: "default",
  received: "success",
  received_with_variance: "warning",
};

export function TransfersDashboard({
  transfers,
  requestedLineItemsByTransfer,
  skus,
  stores,
  currentUserId,
  currentStoreId,
  role,
}: TransfersDashboardProps) {
  const router = useRouter();
  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  const [requestOpen, setRequestOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<PendingTransfer | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PendingTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRequest = role === "store_manager" && currentStoreId !== null;

  function skuLabel(skuId: string): string {
    return skuById.get(skuId)?.code ?? skuId;
  }
  function storeLabel(storeId: string): string {
    return storeById.get(storeId)?.name ?? storeId;
  }

  function closeSheets() {
    setRequestOpen(false);
    setDispatchTarget(null);
    setReceiveTarget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Transfers</h1>
        {canRequest && (
          <Sheet open={requestOpen} onOpenChange={setRequestOpen}>
            <SheetTrigger asChild>
              <Button type="button">New transfer request</Button>
            </SheetTrigger>
            <SheetContent>
              <RequestTransferForm
                sourceStoreId={currentStoreId}
                stores={stores}
                skus={skus}
                currentUserId={currentUserId}
                onDone={closeSheets}
                onError={setError}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((transfer) => {
                const canDispatch =
                  role === "store_manager" && currentStoreId === transfer.source_store_id && transfer.state === "requested";
                const canReceive =
                  role === "store_manager" &&
                  currentStoreId === transfer.destination_store_id &&
                  (transfer.state === "dispatched" || transfer.state === "in_transit");

                return (
                  <TableRow key={transfer.transfer_id}>
                    <TableCell>{storeLabel(transfer.source_store_id)}</TableCell>
                    <TableCell>{storeLabel(transfer.destination_store_id)}</TableCell>
                    <TableCell>
                      <Badge variant={STATE_BADGE_VARIANT[transfer.state]}>{STATE_LABEL[transfer.state]}</Badge>
                    </TableCell>
                    <TableCell>
                      {transfer.requested_at !== null ? new Date(transfer.requested_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {transfer.variance_line_items !== null
                        ? transfer.variance_line_items
                            .map((item) => `${skuLabel(item.sku_id)} ${item.qty > 0 ? "+" : ""}${item.qty}`)
                            .join(", ")
                        : "—"}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {canDispatch && (
                        <Button type="button" size="sm" onClick={() => setDispatchTarget(transfer)}>
                          Dispatch
                        </Button>
                      )}
                      {canReceive && (
                        <Button type="button" size="sm" onClick={() => setReceiveTarget(transfer)}>
                          Receive
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {transfers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-on-surface-variant">
                    No transfers yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={dispatchTarget !== null} onOpenChange={(open) => !open && setDispatchTarget(null)}>
        <SheetContent>
          {dispatchTarget !== null && (
            <DispatchTransferForm
              transfer={dispatchTarget}
              initialLineItems={requestedLineItemsByTransfer[dispatchTarget.transfer_id] ?? []}
              skus={skus}
              currentUserId={currentUserId}
              onDone={closeSheets}
              onError={setError}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={receiveTarget !== null} onOpenChange={(open) => !open && setReceiveTarget(null)}>
        <SheetContent>
          {receiveTarget !== null && (
            <ReceiveTransferForm
              transfer={receiveTarget}
              skus={skus}
              currentUserId={currentUserId}
              onDone={closeSheets}
              onError={setError}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

type LineItemRow = { sku_id: string; qty: string };

function defaultRows(skus: SkuOption[], initial: TransferLineItemInput[]): LineItemRow[] {
  if (initial.length > 0) return initial.map((item) => ({ sku_id: item.sku_id, qty: String(item.qty) }));
  return [{ sku_id: skus[0]?.sku_id ?? "", qty: "" }];
}

function parseLineItemRows(rows: LineItemRow[]): TransferLineItemInput[] {
  return rows
    .filter((row) => row.sku_id !== "" && row.qty.trim() !== "")
    .map((row) => ({ sku_id: row.sku_id, qty: Number(row.qty) }));
}

type LineItemsFieldsProps = {
  skus: SkuOption[];
  rows: LineItemRow[];
  onChange: (rows: LineItemRow[]) => void;
};

function LineItemsFields({ skus, rows, onChange }: LineItemsFieldsProps) {
  function updateRow(index: number, patch: Partial<LineItemRow>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    onChange([...rows, { sku_id: skus[0]?.sku_id ?? "", qty: "" }]);
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`line-sku-${index}`}>SKU</Label>
            <select
              id={`line-sku-${index}`}
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
            <Label htmlFor={`line-qty-${index}`}>Qty</Label>
            <Input
              id={`line-qty-${index}`}
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
  );
}

type RequestTransferFormProps = {
  sourceStoreId: string;
  stores: StoreOption[];
  skus: SkuOption[];
  currentUserId: string;
  onDone: () => void;
  onError: (message: string) => void;
};

function RequestTransferForm({ sourceStoreId, stores, skus, currentUserId, onDone, onError }: RequestTransferFormProps) {
  const destinationOptions = stores.filter((store) => store.store_id !== sourceStoreId);
  const [destinationStoreId, setDestinationStoreId] = useState(destinationOptions[0]?.store_id ?? "");
  const [rows, setRows] = useState<LineItemRow[]>(defaultRows(skus, []));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const lineItems = parseLineItemRows(rows);
    if (destinationStoreId === "" || lineItems.length === 0) {
      onError("Destination store and at least one line item are required.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await requestTransfer(supabase, currentUserId, { sourceStoreId, destinationStoreId, lineItems });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>New transfer request</SheetTitle>
        <SheetDescription>Requests the destination store confirm they need this stock — it doesn&apos;t move anything yet.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="destination-store">Destination store</Label>
          <select
            id="destination-store"
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

        <LineItemsFields skus={skus} rows={rows} onChange={setRows} />
      </div>

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
      </SheetFooter>
    </div>
  );
}

type DispatchTransferFormProps = {
  transfer: Pick<PendingTransfer, "transfer_id" | "source_store_id" | "destination_store_id">;
  initialLineItems: TransferLineItemInput[];
  skus: SkuOption[];
  currentUserId: string;
  onDone: () => void;
  onError: (message: string) => void;
};

function DispatchTransferForm({ transfer, initialLineItems, skus, currentUserId, onDone, onError }: DispatchTransferFormProps) {
  const [rows, setRows] = useState<LineItemRow[]>(defaultRows(skus, initialLineItems));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const lineItems = parseLineItemRows(rows);
    if (lineItems.length === 0) {
      onError("At least one line item is required.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await dispatchTransfer(supabase, currentUserId, transfer, lineItems);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Dispatch transfer</SheetTitle>
        <SheetDescription>Confirm what actually shipped — this debits source store stock immediately.</SheetDescription>
      </SheetHeader>

      <LineItemsFields skus={skus} rows={rows} onChange={setRows} />

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Dispatching…" : "Confirm dispatch"}
        </Button>
      </SheetFooter>
    </div>
  );
}

type ReceiveTransferFormProps = {
  transfer: Pick<PendingTransfer, "transfer_id" | "source_store_id" | "destination_store_id" | "dispatched_line_items">;
  skus: SkuOption[];
  currentUserId: string;
  onDone: () => void;
  onError: (message: string) => void;
};

function ReceiveTransferForm({ transfer, skus, currentUserId, onDone, onError }: ReceiveTransferFormProps) {
  const [rows, setRows] = useState<LineItemRow[]>(defaultRows(skus, transfer.dispatched_line_items ?? []));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const lineItems = parseLineItemRows(rows);
    if (lineItems.length === 0) {
      onError("At least one line item is required.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await receiveTransfer(supabase, currentUserId, transfer, lineItems);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Confirm receipt</SheetTitle>
        <SheetDescription>
          Enter what actually arrived. Any line that doesn&apos;t match the dispatched qty is recorded as its own variance event —
          never silently merged into the received amount.
        </SheetDescription>
      </SheetHeader>

      <LineItemsFields skus={skus} rows={rows} onChange={setRows} />

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Confirming…" : "Confirm receipt"}
        </Button>
      </SheetFooter>
    </div>
  );
}
