import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadLookups, parseShiftFilters, type SearchParams } from "../../../lib/sales/filters";
import { listShifts, summariseShifts } from "../../../lib/sales/service";
import { formatDateTime, formatMoney } from "../../../lib/format";
import { FilterBar, Pagination } from "../../../components/sales/filter-bar";
import { Badge } from "../../../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

function overShortClass(value: number | null): string {
  if (value === null || Number(value) === 0) return "";
  return Number(value) < 0 ? "text-destructive font-semibold" : "text-amber-700 font-semibold";
}

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const isHq = claims.role === "hq_admin";
  const filters = parseShiftFilters(await searchParams);
  if (!isHq) filters.storeId = claims.storeId;

  const supabase = await createSupabaseServerClient();
  const [{ rows, total }, lookups] = await Promise.all([listShifts(supabase, filters), loadLookups(supabase)]);
  const totals = summariseShifts(rows);
  const query = {
    from: filters.from,
    to: filters.to,
    store_id: isHq ? filters.storeId : null,
    till_id: filters.tillId,
    cashier_id: filters.cashierId,
    status: filters.status,
    discrepancy: filters.discrepancyOnly,
  };

  return (
    <main className="flex flex-col gap-md p-md">
      <div>
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Shifts &amp; cash-up</h1>
        <p className="text-body-md text-on-surface-variant">Over/short = cash counted − opening float − system cash (FR-008, FR-032).</p>
      </div>
      <FilterBar
        action="/shifts"
        values={filters}
        lists={lookups.lists}
        showStore={isHq}
        statuses={[
          { value: "open", label: "Open" },
          { value: "closed", label: "Closed" },
        ]}
        extra={
          <label className="flex items-center gap-2 pb-2 text-body-md text-on-surface">
            <input type="checkbox" name="discrepancy" value="1" defaultChecked={filters.discrepancyOnly} />
            Over/short only
          </label>
        }
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opened</TableHead>
            <TableHead>Closed</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Till</TableHead>
            <TableHead>Cashier</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Float</TableHead>
            <TableHead className="text-right">System cash</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Over / short</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((shift) => (
            <TableRow key={shift.shift_id}>
              <TableCell>{formatDateTime(shift.opened_at)}</TableCell>
              <TableCell>{formatDateTime(shift.closed_at)}</TableCell>
              <TableCell>{lookups.maps.stores.get(shift.store_id) ?? "—"}</TableCell>
              <TableCell>{lookups.maps.tills.get(shift.till_id)?.label ?? "—"}</TableCell>
              <TableCell>{lookups.maps.users.get(shift.cashier_id) ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={shift.status === "open" ? "warning" : "outline"}>{shift.status}</Badge>
              </TableCell>
              <TableCell className="text-right">{formatMoney(shift.opening_float)}</TableCell>
              <TableCell className="text-right">{formatMoney(shift.system_cash)}</TableCell>
              <TableCell className="text-right">{formatMoney(shift.cash_counted)}</TableCell>
              <TableCell className={`text-right ${overShortClass(shift.over_short)}`}>{formatMoney(shift.over_short)}</TableCell>
              <TableCell className="text-right">
                <Link href={`/sales?shift_id=${shift.shift_id}` as Route} className="text-primary hover:underline">
                  Sales
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-on-surface-variant">
                No shifts match these filters.
              </TableCell>
            </TableRow>
          ) : (
            <TableRow className="font-semibold">
              <TableCell colSpan={6}>Totals (this page)</TableCell>
              <TableCell className="text-right">{formatMoney(totals.float)}</TableCell>
              <TableCell className="text-right">{formatMoney(totals.system)}</TableCell>
              <TableCell className="text-right">{formatMoney(totals.counted)}</TableCell>
              <TableCell className={`text-right ${overShortClass(totals.overShort)}`}>{formatMoney(totals.overShort)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Pagination path="/shifts" query={query} page={filters.page} total={total} />
    </main>
  );
}
