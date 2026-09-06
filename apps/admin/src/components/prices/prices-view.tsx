"use client";

import { useActionState, useMemo, useState } from "react";
import { createPriceChange, type PriceChangeFormState } from "../../app/prices/actions";
import type { PriceCatalogRow, SkuOption, StoreOption } from "../../lib/prices/change";
import type { PriceAuditRow } from "../../lib/audit/price-audit";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

export type PricesViewProps = {
  skus: SkuOption[];
  stores: StoreOption[];
  activePrices: PriceCatalogRow[];
  auditLog: PriceAuditRow[];
};

const initialState: PriceChangeFormState = { error: null, success: false };

export function PricesView({ skus, stores, activePrices, auditLog }: PricesViewProps) {
  const [state, formAction, pending] = useActionState(createPriceChange, initialState);
  const [skuFilter, setSkuFilter] = useState("all");

  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  const rows = useMemo(
    () => (skuFilter === "all" ? activePrices : activePrices.filter((row) => row.sku_id === skuFilter)),
    [activePrices, skuFilter],
  );

  return (
    <div className="grid grid-cols-1 gap-md xl:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-md">
        <Card>
          <CardHeader>
            <CardTitle>New price change</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="sku_id">SKU</Label>
                <select
                  id="sku_id"
                  name="sku_id"
                  required
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
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
                  defaultValue=""
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
                >
                  <option value="">Global (all stores)</option>
                  {stores.map((store) => (
                    <option key={store.store_id} value={store.store_id}>
                      {store.code} — {store.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="new_unit_price">New unit price (ZMW)</Label>
                <Input id="new_unit_price" name="new_unit_price" type="number" min="0" step="0.01" required />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="effective_from">Effective from</Label>
                <Input id="effective_from" name="effective_from" type="datetime-local" />
              </div>

              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="reason">Reason</Label>
                <Input id="reason" name="reason" type="text" placeholder="Supplier cost increase, promotion end, …" />
              </div>

              {state.error !== null && (
                <p role="alert" className="text-body-md font-body-md text-destructive sm:col-span-2">
                  {state.error}
                </p>
              )}
              {state.success && (
                <p className="text-body-md font-body-md text-green-700 sm:col-span-2">Price change committed.</p>
              )}

              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "Submitting…" : "Commit price change"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Active prices</CardTitle>
            <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface-variant">
              SKU
              <select
                value={skuFilter}
                onChange={(event) => setSkuFilter(event.target.value)}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1"
              >
                <option value="all">All SKUs</option>
                {skus.map((sku) => (
                  <option key={sku.sku_id} value={sku.sku_id}>
                    {sku.code}
                  </option>
                ))}
              </select>
            </label>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Effective from</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.price_version_id}>
                  <TableCell>{skuById.get(row.sku_id)?.code ?? row.sku_id}</TableCell>
                  <TableCell>
                    {row.store_id === null ? (
                      <Badge variant="secondary">Global</Badge>
                    ) : (
                      (storeById.get(row.store_id)?.code ?? row.store_id)
                    )}
                  </TableCell>
                  <TableCell>
                    {row.currency} {row.unit_price.toFixed(2)}
                  </TableCell>
                  <TableCell>{new Date(row.effective_from).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-4 text-center text-on-surface-variant">
                    No active prices yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Recent price changes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {auditLog.map((entry) => (
            <div key={entry.audit_id} className="border-b border-outline-variant/40 pb-2 last:border-0 last:pb-0">
              <p className="text-body-md font-body-md text-on-surface">
                {skuById.get(entry.sku_id ?? "")?.code ?? entry.sku_id ?? "—"}
                {": "}
                {entry.old_unit_price !== null ? entry.old_unit_price.toFixed(2) : "—"} → {entry.new_unit_price?.toFixed(2) ?? "—"}
              </p>
              <p className="text-label-sm font-label-sm text-on-surface-variant">
                {entry.actor_name ?? "Unknown"} · {new Date(entry.server_ts).toLocaleString()}
              </p>
            </div>
          ))}
          {auditLog.length === 0 && <p className="text-body-md font-body-md text-on-surface-variant">No price changes yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
