"use client";

import { useMemo, useState } from "react";
import type { SalesReport } from "../lib/reports/sales";
import type { InventoryReport } from "../lib/reports/inventory";
import type { ReconciliationReport } from "../lib/reports/reconciliation";
import type { StoreOption } from "../lib/catalog/options";
import type { ProvisionalMarker, ReportDateRange } from "../lib/reports/shared";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type ReportExportKind =
  | "sales_by_store"
  | "sales_by_cashier"
  | "sales_by_sku"
  | "inventory_on_hand"
  | "transfer_history"
  | "till_reconciliation";

export type ReportsDashboardProps = {
  range: ReportDateRange;
  storeId?: string;
  stores: StoreOption[];
  categories: { category_id: string; name: string }[];
  skus: { sku_id: string; name: string }[];
  isStoreManager: boolean;
  sales: SalesReport;
  inventory: InventoryReport;
  reconciliation: ReconciliationReport;
  provisional: ProvisionalMarker;
};

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReportsDashboard(props: ReportsDashboardProps) {
  const storeById = useMemo(() => new Map(props.stores.map((store) => [store.store_id, store])), [props.stores]);
  const categoryById = useMemo(() => new Map(props.categories.map((category) => [category.category_id, category.name])), [props.categories]);
  const skuById = useMemo(() => new Map(props.skus.map((sku) => [sku.sku_id, sku.name])), [props.skus]);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex items-start justify-between gap-md">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Reports</h1>
        <a href="/reports/dashboard" className="text-body-md font-body-md text-primary underline-offset-4 hover:underline">
          Consolidated dashboard →
        </a>
      </div>

      {props.provisional.isProvisional && (
        <Badge variant="warning" className="w-fit">
          Provisional — one or more tills have unsynced data for this range
          {props.provisional.provisionalUntilServerTs !== null
            ? ` (as of ${new Date(props.provisional.provisionalUntilServerTs).toLocaleString()})`
            : ""}
        </Badge>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-md">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={props.range.from} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={props.range.to} />
            </div>
            {!props.isStoreManager && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="store_id">Store</Label>
                <select
                  id="store_id"
                  name="store_id"
                  defaultValue={props.storeId ?? ""}
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md text-on-surface"
                >
                  <option value="">All stores</option>
                  {props.stores.map((store) => (
                    <option key={store.store_id} value={store.store_id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <SalesSection sales={props.sales} storeById={storeById} categoryById={categoryById} skuById={skuById} range={props.range} storeId={props.storeId} />
      <InventorySection inventory={props.inventory} storeById={storeById} skuById={skuById} range={props.range} storeId={props.storeId} />
      <ReconciliationSection reconciliation={props.reconciliation} storeById={storeById} range={props.range} storeId={props.storeId} />
    </div>
  );
}

function ExportButtons({ report, range, storeId }: { report: ReportExportKind; range: ReportDateRange; storeId?: string }) {
  const [pending, setPending] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: "csv" | "pdf") {
    setPending(format);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.functions.invoke("report-export", {
        body: { report, params: { from: range.from, to: range.to, store_id: storeId }, format },
      });
      const invokeError: unknown = result.error;
      if (invokeError !== null) {
        throw invokeError instanceof Error ? invokeError : new Error(JSON.stringify(invokeError));
      }
      const data: unknown = result.data;
      const downloadUrl =
        typeof data === "object" && data !== null && "download_url" in data && typeof data.download_url === "string"
          ? data.download_url
          : null;
      if (downloadUrl !== null) {
        window.open(downloadUrl, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Export failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void handleExport("csv")}>
        {pending === "csv" ? "Exporting…" : "Export CSV"}
      </Button>
      <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void handleExport("pdf")}>
        {pending === "pdf" ? "Exporting…" : "Export PDF"}
      </Button>
      {error !== null && <span className="text-body-md font-body-md text-error">{error}</span>}
    </div>
  );
}

type StoreLookup = Map<string, StoreOption>;

function SalesSection({
  sales,
  storeById,
  categoryById,
  skuById,
  range,
  storeId,
}: {
  sales: SalesReport;
  storeById: StoreLookup;
  categoryById: Map<string, string>;
  skuById: Map<string, string>;
  range: ReportDateRange;
  storeId?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sales</CardTitle>
        <ExportButtons report="sales_by_store" range={range} storeId={storeId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-lg">
        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">By store</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Discounts</TableHead>
                <TableHead>Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.byStore.map((row) => (
                <TableRow key={row.store_id}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{row.sale_count}</TableCell>
                  <TableCell>{money(row.net_sales)}</TableCell>
                  <TableCell>{money(row.discount_total)}</TableCell>
                  <TableCell>{money(row.tax_total)}</TableCell>
                </TableRow>
              ))}
              {sales.byStore.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-on-surface-variant">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">By till</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Till</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.byTill.map((row) => (
                <TableRow key={row.till_id}>
                  <TableCell>{row.till_id}</TableCell>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{row.sale_count}</TableCell>
                  <TableCell>{money(row.net_sales)}</TableCell>
                </TableRow>
              ))}
              {sales.byTill.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-label-caps font-label-caps uppercase text-on-surface-variant">By cashier</h3>
            <ExportButtons report="sales_by_cashier" range={range} storeId={storeId} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.byCashier.map((row) => (
                <TableRow key={row.cashier_id}>
                  <TableCell>{row.cashier_id}</TableCell>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{row.sale_count}</TableCell>
                  <TableCell>{money(row.net_sales)}</TableCell>
                </TableRow>
              ))}
              {sales.byCashier.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-label-caps font-label-caps uppercase text-on-surface-variant">By SKU / category</h3>
            <ExportButtons report="sales_by_sku" range={range} storeId={storeId} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Qty sold</TableHead>
                <TableHead>Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.bySku.map((row) => (
                <TableRow key={row.sku_id}>
                  <TableCell>{skuById.get(row.sku_id) ?? row.sku_id}</TableCell>
                  <TableCell>{row.category_id !== null ? (categoryById.get(row.category_id) ?? row.category_id) : "—"}</TableCell>
                  <TableCell>{row.qty_sold}</TableCell>
                  <TableCell>{money(row.line_total)}</TableCell>
                </TableRow>
              ))}
              {sales.bySku.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">By hour / day</h3>
          <div className="grid grid-cols-1 gap-md md:grid-cols-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hour (UTC)</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.byHour.map((row) => (
                  <TableRow key={row.hour}>
                    <TableCell>{row.hour.toString().padStart(2, "0")}:00</TableCell>
                    <TableCell>{row.sale_count}</TableCell>
                    <TableCell>{money(row.net_sales)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.byDay.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell>{row.day}</TableCell>
                    <TableCell>{row.sale_count}</TableCell>
                    <TableCell>{money(row.net_sales)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InventorySection({
  inventory,
  storeById,
  skuById,
  range,
  storeId,
}: {
  inventory: InventoryReport;
  storeById: StoreLookup;
  skuById: Map<string, string>;
  range: ReportDateRange;
  storeId?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Inventory</CardTitle>
        <ExportButtons report="inventory_on_hand" range={range} storeId={storeId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-lg">
        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">On hand</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty on hand</TableHead>
                <TableHead>In transit out</TableHead>
                <TableHead>In transit in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.onHand.map((row) => (
                <TableRow key={`${row.store_id}:${row.sku_id}`}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id) ?? row.sku_id}</TableCell>
                  <TableCell>{row.is_oversold ? <Badge variant="destructive">{row.qty_on_hand}</Badge> : row.qty_on_hand}</TableCell>
                  <TableCell>{row.qty_in_transit_out}</TableCell>
                  <TableCell>{row.qty_in_transit_in}</TableCell>
                </TableRow>
              ))}
              {inventory.onHand.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-on-surface-variant">
                    No stock rows.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-label-caps font-label-caps uppercase text-on-surface-variant">Transfer history</h3>
            <ExportButtons report="transfer_history" range={range} storeId={storeId} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.transferHistory.map((row) => (
                <TableRow key={row.transfer_id}>
                  <TableCell>{row.transfer_id}</TableCell>
                  <TableCell>{storeById.get(row.source_store_id)?.name ?? row.source_store_id}</TableCell>
                  <TableCell>{storeById.get(row.destination_store_id)?.name ?? row.destination_store_id}</TableCell>
                  <TableCell>{row.state}</TableCell>
                  <TableCell>{row.requested_at !== null ? new Date(row.requested_at).toLocaleString() : "—"}</TableCell>
                  <TableCell>{row.received_at !== null ? new Date(row.received_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
              {inventory.transferHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-on-surface-variant">
                    No transfer activity in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">Count corrections</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Delta qty</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.countCorrections.map((row) => (
                <TableRow key={row.event_id}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id) ?? row.sku_id}</TableCell>
                  <TableCell>{row.delta_qty}</TableCell>
                  <TableCell>{row.reason_code ?? "—"}</TableCell>
                  <TableCell>{new Date(row.server_ts).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {inventory.countCorrections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-on-surface-variant">
                    No count corrections in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-2 text-label-caps font-label-caps uppercase text-on-surface-variant">Other shrinkage (adjustments, transfer variance)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Cause</TableHead>
                <TableHead>Delta qty</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.otherShrinkage.map((row) => (
                <TableRow key={row.event_id}>
                  <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                  <TableCell>{skuById.get(row.sku_id) ?? row.sku_id}</TableCell>
                  <TableCell>{row.event_type}</TableCell>
                  <TableCell>{row.delta_qty}</TableCell>
                  <TableCell>{row.reason_code ?? "—"}</TableCell>
                  <TableCell>{new Date(row.server_ts).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {inventory.otherShrinkage.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-on-surface-variant">
                    No other shrinkage in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ReconciliationSection({
  reconciliation,
  storeById,
  range,
  storeId,
}: {
  reconciliation: ReconciliationReport;
  storeById: StoreLookup;
  range: ReportDateRange;
  storeId?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Till reconciliation</CardTitle>
        <ExportButtons report="till_reconciliation" range={range} storeId={storeId} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead>Till</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead>Opening float</TableHead>
              <TableHead>System cash</TableHead>
              <TableHead>Cash counted</TableHead>
              <TableHead>Over/short</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconciliation.shifts.map((row) => (
              <TableRow key={row.shift_id}>
                <TableCell>{storeById.get(row.store_id)?.name ?? row.store_id}</TableCell>
                <TableCell>{row.till_label}</TableCell>
                <TableCell>{row.cashier_name}</TableCell>
                <TableCell>{new Date(row.closed_at).toLocaleString()}</TableCell>
                <TableCell>{money(row.opening_float)}</TableCell>
                <TableCell>{money(row.system_cash)}</TableCell>
                <TableCell>{row.cash_counted !== null ? money(row.cash_counted) : "—"}</TableCell>
                <TableCell>
                  {row.over_short !== null ? (
                    <Badge variant={row.over_short === 0 ? "success" : row.over_short < 0 ? "destructive" : "warning"}>
                      {money(row.over_short)}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
            {reconciliation.shifts.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-on-surface-variant">
                  No closed shifts in this range.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
