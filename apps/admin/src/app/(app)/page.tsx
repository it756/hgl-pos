import Link from "next/link";
import type { Route } from "next";
import { requireSessionClaims } from "../../lib/auth/session";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { loadHomeDashboard, type DayTotals } from "../../lib/dashboard/home";
import { formatDateTime, formatMoney } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

export default async function HomePage() {
  // Not requireRole(): it redirects to "/" and would loop for other roles.
  const claims = await requireSessionClaims();
  if (claims.role !== "hq_admin" && claims.role !== "store_manager") {
    return (
      <main className="p-md">
        <p className="text-body-lg font-body-lg text-on-surface-variant">
          Signed in as {claims.role ?? "unknown role"}. The admin console is for store managers and HQ admins.
        </p>
      </main>
    );
  }
  const supabase = await createSupabaseServerClient();
  const dashboard = await loadHomeDashboard(supabase, claims.role);
  const { alerts } = dashboard;

  const alertTiles: { label: string; value: number; href: string; tone: "danger" | "warning" | "neutral" }[] = [
    { label: "Stores offline / lagging", value: alerts.offlineOrLaggingStores, href: "/sync-health", tone: "danger" },
    { label: "Oversold SKUs", value: alerts.oversoldSkus, href: "/inventory", tone: "danger" },
    { label: "Low-stock SKUs", value: alerts.lowStockSkus, href: "/inventory", tone: "warning" },
    { label: `Batches expiring ≤ ${dashboard.expiryWarningDays}d`, value: alerts.expiringBatches, href: "/inventory", tone: "warning" },
    { label: "Pending adjustments", value: alerts.pendingAdjustments, href: "/adjustments", tone: "warning" },
    { label: "Open transfers", value: alerts.openTransfers, href: "/transfers", tone: "neutral" },
    { label: "Open stock counts", value: alerts.openCounts, href: "/counts", tone: "neutral" },
    { label: "Open shifts", value: alerts.openShifts, href: "/shifts", tone: "neutral" },
  ];

  return (
    <main className="flex flex-col gap-md p-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Dashboard</h1>
        <p className="text-body-md font-body-md text-on-surface-variant">
          {claims.role === "hq_admin" ? "All stores" : "Your store"} · day boundaries in {dashboard.timezone}
        </p>
      </div>

      {dashboard.provisional.isProvisional && (
        <p role="status" className="rounded-lg border border-outline-variant bg-surface-container-low p-sm text-body-md font-body-md text-on-surface-variant">
          Provisional — {dashboard.provisional.staleTillIds.length} till(s) still have unsynced events
          {dashboard.provisional.provisionalUntilServerTs !== null
            ? ` (earliest ${formatDateTime(dashboard.provisional.provisionalUntilServerTs)})`
            : ""}
          ; today&apos;s figures may still change.
        </p>
      )}

      <div className="grid gap-md md:grid-cols-3">
        <KpiCard title="Net sales today" value={formatMoney(dashboard.today.netSales)} today={dashboard.today} yesterday={dashboard.yesterday} />
        <Card>
          <CardHeader>
            <CardTitle>Transactions today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-headline-lg font-headline-lg font-semibold text-on-surface">{dashboard.today.transactions}</p>
            <p className="text-body-md font-body-md text-on-surface-variant">Yesterday: {dashboard.yesterday.transactions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Refunds &amp; voids today</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-headline-lg font-headline-lg font-semibold text-on-surface">{formatMoney(dashboard.today.refunds)}</p>
            <p className="text-body-md font-body-md text-on-surface-variant">Yesterday: {formatMoney(dashboard.yesterday.refunds)}</p>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="alerts-heading" className="flex flex-col gap-sm">
        <h2 id="alerts-heading" className="text-headline-md font-headline-md font-semibold text-on-surface">
          Needs attention
        </h2>
        <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
          {alertTiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href as Route}
              className="flex items-center justify-between rounded-xl border border-surface-container-high bg-surface-container-lowest p-md shadow-sm hover:bg-surface-container-low"
            >
              <span className="text-body-md font-body-md text-on-surface">{tile.label}</span>
              <Badge variant={tile.value === 0 ? "outline" : tile.tone === "danger" ? "destructive" : tile.tone === "warning" ? "warning" : "secondary"}>
                {tile.value}
              </Badge>
            </Link>
          ))}
        </div>
      </section>

      {dashboard.byStore.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sales by store</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead className="text-right">Net today</TableHead>
                  <TableHead className="text-right">Net yesterday</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead>Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.byStore.map((store) => {
                  const sync = dashboard.storeSync.find((summary) => summary.storeId === store.storeId);
                  return (
                    <TableRow key={store.storeId}>
                      <TableCell className="font-medium text-on-surface">{store.storeName}</TableCell>
                      <TableCell className="text-right">{formatMoney(store.netSales)}</TableCell>
                      <TableCell className="text-right">{formatMoney(store.previousNetSales)}</TableCell>
                      <TableCell className="text-right">{store.transactions}</TableCell>
                      <TableCell>
                        {sync === undefined ? (
                          <Badge variant="outline">No tills</Badge>
                        ) : (
                          <Badge variant={sync.status === "online" ? "success" : sync.status === "lagging" ? "warning" : "destructive"}>
                            {sync.status}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function KpiCard({ title, value, today, yesterday }: { title: string; value: string; today: DayTotals; yesterday: DayTotals }) {
  const delta = yesterday.netSales === 0 ? null : ((today.netSales - yesterday.netSales) / Math.abs(yesterday.netSales)) * 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-headline-lg font-headline-lg font-semibold text-on-surface">{value}</p>
        <p className="text-body-md font-body-md text-on-surface-variant">
          Yesterday: {formatMoney(yesterday.netSales)}
          {delta !== null && ` (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)`}
        </p>
      </CardContent>
    </Card>
  );
}