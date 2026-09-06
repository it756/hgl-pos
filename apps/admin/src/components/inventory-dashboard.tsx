"use client";

import { useMemo } from "react";
import type { InventoryOverview } from "../lib/inventory/service";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type InventoryDashboardProps = {
  overview: InventoryOverview;
};

export function InventoryDashboard({ overview }: InventoryDashboardProps) {
  const skuById = useMemo(() => new Map(overview.skus.map((sku) => [sku.sku_id, sku])), [overview.skus]);
  const storeById = useMemo(() => new Map(overview.stores.map((store) => [store.store_id, store])), [overview.stores]);

  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Inventory</h1>

      <Card>
        <CardHeader>
          <CardTitle>Oversold ({overview.oversold.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty on hand</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.oversold.map((row) => (
                <TableRow key={`${row.store_id}:${row.sku_id}`}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id)?.name ?? row.sku_id}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{row.qty_on_hand}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {overview.oversold.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-on-surface-variant">
                    No oversold SKUs.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Low stock ({overview.lowStock.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty on hand</TableHead>
                <TableHead>Reorder point</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.lowStock.map((row) => (
                <TableRow key={`${row.store_id}:${row.sku_id}`}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id)?.name ?? row.sku_id}</TableCell>
                  <TableCell>
                    <Badge variant="warning">{row.qty_on_hand}</Badge>
                  </TableCell>
                  <TableCell>{row.reorder_point}</TableCell>
                </TableRow>
              ))}
              {overview.lowStock.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No SKUs at or below their reorder point.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batches nearing expiry ({overview.batchesNearingExpiry.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Qty remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.batchesNearingExpiry.map((row) => (
                <TableRow key={`${row.store_id}:${row.sku_id}:${row.batch_no}`}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id)?.name ?? row.sku_id}</TableCell>
                  <TableCell>{row.batch_no}</TableCell>
                  <TableCell>{new Date(row.expiry_date).toLocaleDateString()}</TableCell>
                  <TableCell>{row.qty_remaining}</TableCell>
                </TableRow>
              ))}
              {overview.batchesNearingExpiry.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-on-surface-variant">
                    No batches nearing expiry.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
