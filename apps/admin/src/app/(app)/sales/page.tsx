import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadLookups, parseSalesFilters, type SearchParams } from "../../../lib/sales/filters";
import { listSales } from "../../../lib/sales/service";
import { formatDateTime, formatMoney } from "../../../lib/format";
import { Field, FilterBar, Pagination } from "../../../components/sales/filter-bar";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

const STATUS_VARIANT = { completed: "success", voided: "outline", refunded: "warning" } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const isHq = claims.role === "hq_admin";
  const filters = parseSalesFilters(await searchParams);
  // RLS already scopes managers; pinning keeps the filter UI honest.
  if (!isHq) filters.storeId = claims.storeId;

  const supabase = await createSupabaseServerClient();
  const [{ rows, total }, lookups] = await Promise.all([listSales(supabase, filters), loadLookups(supabase)]);
  const query = {
    from: filters.from,
    to: filters.to,
    store_id: isHq ? filters.storeId : null,
    till_id: filters.tillId,
    cashier_id: filters.cashierId,
    shift_id: filters.shiftId,
    status: filters.status,
    min_total: filters.minTotal,
    max_total: filters.maxTotal,
  };

  return (
    <main className="flex flex-col gap-md p-md">
      <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Sales</h1>
      <FilterBar
        action="/sales"
        values={filters}
        lists={lookups.lists}
        showStore={isHq}
        statuses={[
          { value: "completed", label: "Completed" },
          { value: "refunded", label: "Refunds" },
          { value: "voided", label: "Voids" },
        ]}
        extra={
          <>
            <Field label="Min total" htmlFor="filter-min">
              <Input id="filter-min" name="min_total" type="number" step="0.01" className="w-28" defaultValue={filters.minTotal ?? ""} />
            </Field>
            <Field label="Max total" htmlFor="filter-max">
              <Input id="filter-max" name="max_total" type="number" step="0.01" className="w-28" defaultValue={filters.maxTotal ?? ""} />
            </Field>
            {filters.shiftId !== null && <input type="hidden" name="shift_id" value={filters.shiftId} />}
          </>
        }
      />
      {filters.shiftId !== null && (
        <p className="text-body-md text-on-surface-variant">
          Showing every sale in one shift (date range ignored) ·{" "}
          <Link href={`/sales?from=${filters.from}&to=${filters.to}` as Route} className="text-primary hover:underline">
            clear shift filter
          </Link>
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Till</TableHead>
            <TableHead>Cashier</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Discount</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sale) => (
            <TableRow key={sale.sale_id}>
              <TableCell>{formatDateTime(sale.server_ts)}</TableCell>
              <TableCell>{lookups.maps.stores.get(sale.store_id) ?? "—"}</TableCell>
              <TableCell>{lookups.maps.tills.get(sale.till_id)?.label ?? "—"}</TableCell>
              <TableCell>{lookups.maps.users.get(sale.cashier_id) ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[sale.status]}>{sale.status}</Badge>
                {sale.status === "completed" && sale.latest_status !== "completed" && (
                  <span className="ml-1 text-body-sm text-on-surface-variant">(later {sale.latest_status})</span>
                )}
              </TableCell>
              <TableCell className="text-right">{formatMoney(sale.discount_total)}</TableCell>
              <TableCell className="text-right font-medium">{formatMoney(sale.grand_total)}</TableCell>
              <TableCell className="text-right">
                <Link href={`/sales/${sale.sale_id}` as Route} className="text-primary hover:underline">
                  Details
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-on-surface-variant">
                No sales match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Pagination path="/sales" query={query} page={filters.page} total={total} />
    </main>
  );
}
