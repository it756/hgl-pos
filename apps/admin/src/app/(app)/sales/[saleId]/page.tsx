import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { loadLookups } from "../../../../lib/sales/filters";
import { loadSaleDetail, type SaleRow } from "../../../../lib/sales/service";
import { formatDateTime, formatMoney, formatQty } from "../../../../lib/format";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

const TENDER_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money_mtn: "MTN Mobile Money",
  mobile_money_airtel: "Airtel Money",
};

export default async function SaleDetailPage({ params }: { params: Promise<{ saleId: string }> }) {
  await requireRole(["hq_admin", "store_manager"]);
  const { saleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) notFound();

  const supabase = await createSupabaseServerClient();
  const [detail, lookups] = await Promise.all([loadSaleDetail(supabase, saleId), loadLookups(supabase)]);
  if (detail === null) notFound();
  const { sale } = detail;

  const saleLink = (row: SaleRow) => (
    <Link href={`/sales/${row.sale_id}` as Route} className="text-primary hover:underline">
      {row.status} · {formatMoney(row.grand_total)} · {formatDateTime(row.server_ts)}
    </Link>
  );

  return (
    <main className="flex flex-col gap-md p-md">
      <Link href="/sales" className="text-body-md text-primary hover:underline">
        ← Sales
      </Link>
      <h1 className="flex items-center gap-2 text-headline-lg font-headline-lg font-semibold text-on-surface">
        Sale {sale.sale_id.slice(0, 8)}
        <Badge variant={sale.status === "completed" ? "success" : "warning"}>{sale.status}</Badge>
        {sale.refund_kind !== null && <Badge variant="outline">{sale.refund_kind.replace(/_/g, " ")}</Badge>}
      </h1>

      <div className="grid gap-md md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Where &amp; who</CardTitle>
          </CardHeader>
          <CardContent className="text-body-md text-on-surface">
            <p>Store: {lookups.maps.stores.get(sale.store_id) ?? sale.store_id}</p>
            <p>Till: {lookups.maps.tills.get(sale.till_id)?.label ?? sale.till_id}</p>
            <p>Cashier: {lookups.maps.users.get(sale.cashier_id) ?? sale.cashier_id}</p>
            <p>
              Shift:{" "}
              <Link href={`/sales?shift_id=${sale.shift_id}` as Route} className="text-primary hover:underline">
                {sale.shift_id.slice(0, 8)}
              </Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>When</CardTitle>
          </CardHeader>
          <CardContent className="text-body-md text-on-surface">
            <p>Rung up (till clock): {formatDateTime(sale.client_ts)}</p>
            <p>Synced (server): {formatDateTime(sale.server_ts)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent className="text-body-md text-on-surface">
            <p>Subtotal: {formatMoney(sale.subtotal)}</p>
            <p>Discounts: {formatMoney(sale.discount_total)}</p>
            <p>Tax: {formatMoney(sale.tax_total)}</p>
            <p className="font-semibold">Total: {formatMoney(sale.grand_total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-body-sm text-on-surface-variant">Prices are as charged at the till — never re-priced afterwards (FR-028).</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                <TableHead>Promotion</TableHead>
                <TableHead>Batch / expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.items.map((item, index) => {
                const sku = detail.skus.get(item.sku_id);
                return (
                  <TableRow key={`${item.sku_id}-${index}`}>
                    <TableCell>{sku === undefined ? item.sku_id : `${sku.code} · ${sku.name}`}</TableCell>
                    <TableCell className="text-right">{formatQty(item.qty)}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.unit_price)}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.line_discount ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.line_total)}</TableCell>
                    <TableCell>{item.promotion_id === null ? "—" : (detail.promotions.get(item.promotion_id) ?? "Promotion")}</TableCell>
                    <TableCell>{[item.batch_no, item.expiry_date].filter(Boolean).join(" / ") || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-md md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tenders</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-body-md text-on-surface">
              {detail.tenders.map((tender, index) => (
                <li key={index} className="flex justify-between">
                  <span>
                    {TENDER_LABEL[tender.type] ?? tender.type}
                    {tender.card_masked_pan !== undefined && ` ${tender.card_masked_pan}`}
                    {tender.reference !== null && tender.type !== "card" && ` · ref ${tender.reference}`}
                  </span>
                  <span>{formatMoney(tender.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Voids &amp; refunds</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-body-md text-on-surface">
            {detail.original !== null && <p>Refund of: {saleLink(detail.original)}</p>}
            {detail.related.map((row) => (
              <p key={row.sale_id}>{saleLink(row)}</p>
            ))}
            {detail.original === null && detail.related.length === 0 && <p className="text-on-surface-variant">None.</p>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
