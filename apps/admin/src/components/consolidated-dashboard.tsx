"use client";

import { useMemo } from "react";
import type { SalesByStoreRow } from "../lib/reports/sales";
import type { StoreOption } from "../lib/catalog/options";
import type { ProvisionalMarker, ReportDateRange } from "../lib/reports/shared";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type ConsolidatedDashboardProps = {
  range: ReportDateRange;
  stores: StoreOption[];
  byStore: SalesByStoreRow[];
  provisional: ProvisionalMarker;
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ConsolidatedDashboard({ range, stores, byStore, provisional }: ConsolidatedDashboardProps) {
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  const totals = byStore.reduce(
    (acc, row) => ({
      sale_count: acc.sale_count + row.sale_count,
      net_sales: acc.net_sales + row.net_sales,
      discount_total: acc.discount_total + row.discount_total,
      tax_total: acc.tax_total + row.tax_total,
    }),
    { sale_count: 0, net_sales: 0, discount_total: 0, tax_total: 0 },
  );

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-start justify-between gap-md">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Consolidated dashboard</h1>
        <a href="/reports" className="text-body-md font-body-md text-primary underline-offset-4 hover:underline">
          ← Back to reports
        </a>
      </div>

      {provisional.isProvisional && (
        <Badge variant="warning" className="w-fit">
          Provisional — {provisional.staleTillIds.length} till(s) haven&apos;t synced past this range yet
          {provisional.provisionalUntilServerTs !== null
            ? `; earliest un-synced event at ${new Date(provisional.provisionalUntilServerTs).toLocaleString()}`
            : ""}
          . Totals may still change once they catch up.
        </Badge>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Date range</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-md">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={range.from} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={range.to} />
            </div>
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fleet totals</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-md md:grid-cols-4">
          <Stat label="Sales" value={totals.sale_count.toString()} />
          <Stat label="Net sales" value={money(totals.net_sales)} />
          <Stat label="Discounts" value={money(totals.discount_total)} />
          <Stat label="Tax" value={money(totals.tax_total)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By store</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Net sales</TableHead>
                <TableHead>Discounts</TableHead>
                <TableHead>Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStore.map((row) => (
                <TableRow key={row.store_id}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{row.sale_count}</TableCell>
                  <TableCell>{money(row.net_sales)}</TableCell>
                  <TableCell>{money(row.discount_total)}</TableCell>
                  <TableCell>{money(row.tax_total)}</TableCell>
                </TableRow>
              ))}
              {byStore.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-on-surface-variant">
                    No sales in this range.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-caps font-label-caps uppercase text-on-surface-variant">{label}</span>
      <span className="text-display-stat font-display-stat text-on-surface">{value}</span>
    </div>
  );
}
