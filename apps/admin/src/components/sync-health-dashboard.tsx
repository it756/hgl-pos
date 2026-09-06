"use client";

import { useMemo, useState } from "react";
import { Package, PlugZap, Store, WifiOff } from "lucide-react";
import {
  buildFleetSummary,
  buildStoreSummaries,
  classifyStaleness,
  STALENESS_BUCKET_LABELS,
  type AppVersionCohort,
  type StalenessBucket,
  type StoreStatus,
  type TillSyncHealthRow,
} from "../lib/monitoring/sync-health";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

type SortColumn = "store" | "till" | "staleness" | "queue_depth";
type SortDirection = "asc" | "desc";

export type SyncHealthDashboardProps = {
  tills: TillSyncHealthRow[];
  cohorts: AppVersionCohort[];
  oversoldSkuCount: number;
  scope: "fleet" | "store";
};

const STALENESS_ORDER: Record<StalenessBucket, number> = {
  under_1_min: 0,
  under_5_min: 1,
  under_30_min: 2,
  under_4_hours: 3,
  over_4_hours: 4,
  never_synced: 5,
};

export function SyncHealthDashboard({ tills, cohorts, oversoldSkuCount, scope }: SyncHealthDashboardProps) {
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("staleness");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const storeSummaries = useMemo(() => buildStoreSummaries(tills), [tills]);
  const fleetSummary = useMemo(() => buildFleetSummary(storeSummaries), [storeSummaries]);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const till of tills) seen.set(till.store_code, till.store_name);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tills]);

  const rows = useMemo(() => {
    const filtered = storeFilter === "all" ? tills : tills.filter((till) => till.store_code === storeFilter);
    return [...filtered].sort((a, b) => compareRows(a, b, sortColumn, sortDirection));
  }, [tills, storeFilter, sortColumn, sortDirection]);

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  return (
    <div className="space-y-md">
      {scope === "fleet" && (
        <div className="grid grid-cols-2 gap-md md:grid-cols-4">
          <FleetStatCard label="Total Stores" value={fleetSummary.totalStores} icon={Store} tone="neutral" />
          <FleetStatCard label="Online" value={fleetSummary.onlineStores} icon={PlugZap} tone="success" />
          <FleetStatCard label="Offline / Lagging" value={fleetSummary.offlineOrLaggingStores} icon={WifiOff} tone="destructive" />
          <FleetStatCard label="Active Tills" value={fleetSummary.totalActiveTills} icon={Package} tone="neutral" />
        </div>
      )}

      {scope === "fleet" && (
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {storeSummaries.map((store) => (
            <StoreStatusCard key={store.storeId} storeName={store.storeName} tillCount={store.tillCount} status={store.status} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="warning">
          {oversoldSkuCount} oversold SKU{oversoldSkuCount === 1 ? "" : "s"}
        </Badge>

        {cohorts.map((cohort) => (
          <Badge key={cohort.appVersion} variant="secondary">
            {cohort.appVersion} · {cohort.tillCount} till{cohort.tillCount === 1 ? "" : "s"}
          </Badge>
        ))}

        {scope === "fleet" && (
          <label className="ml-auto flex items-center gap-2 text-body-md font-body-md text-on-surface-variant">
            Store
            <select
              value={storeFilter}
              onChange={(event) => setStoreFilter(event.target.value)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1"
            >
              <option value="all">All stores</option>
              {storeOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {scope === "fleet" && (
                <SortableHeader label="Store" column="store" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
              )}
              <SortableHeader label="Till" column="till" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader label="Staleness" column="staleness" active={sortColumn} direction={sortDirection} onSort={toggleSort} />
              <SortableHeader
                label="Queue depth"
                column="queue_depth"
                active={sortColumn}
                direction={sortDirection}
                onSort={toggleSort}
              />
              <TableHead>Roster last refreshed</TableHead>
              <TableHead>App version</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((till) => {
              const staleness = classifyStaleness(till.server_ts);
              return (
                <TableRow key={till.till_id}>
                  {scope === "fleet" && <TableCell>{till.store_name}</TableCell>}
                  <TableCell>{till.till_label}</TableCell>
                  <TableCell>
                    <Badge variant={stalenessBadgeVariant(staleness)}>{STALENESS_BUCKET_LABELS[staleness]}</Badge>
                  </TableCell>
                  <TableCell>{till.queue_depth ?? "—"}</TableCell>
                  <TableCell>{formatRelative(till.last_successful_sync_at)}</TableCell>
                  <TableCell>{till.app_version ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={scope === "fleet" ? 6 : 5} className="py-4 text-center text-on-surface-variant">
                  No tills to show.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FleetStatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Store;
  tone: "neutral" | "success" | "destructive";
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "text-primary bg-surface-container",
    success: "text-green-600 bg-green-50",
    destructive: "text-error bg-error-container",
  };

  return (
    <Card className="p-md">
      <div className="mb-2 flex items-start justify-between">
        <span className="text-label-sm font-label-sm uppercase tracking-wider text-on-surface-variant">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${toneClasses[tone]}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <div className="text-display-stat font-display-stat text-on-surface">{value}</div>
    </Card>
  );
}

function StoreStatusCard({ storeName, tillCount, status }: { storeName: string; tillCount: number; status: StoreStatus }) {
  const dotClass = status === "online" ? "bg-green-500" : status === "lagging" ? "bg-amber-500" : "bg-error";
  const badgeVariant = status === "online" ? "success" : status === "lagging" ? "warning" : "destructive";
  const cardTone =
    status === "online"
      ? "border-surface-container-high"
      : status === "lagging"
        ? "border-amber-200 bg-amber-50"
        : "border-error bg-error-container";

  return (
    <Card className={`p-md ${cardTone}`}>
      <div className="mb-2 flex items-start justify-between">
        <h3 className="flex items-center gap-2 text-headline-md font-headline-md font-semibold text-on-surface">
          {storeName}
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        </h3>
        <Badge variant={badgeVariant}>{status}</Badge>
      </div>
      <p className="text-body-md font-body-md text-on-surface-variant">
        {tillCount} till{tillCount === 1 ? "" : "s"}
      </p>
    </Card>
  );
}

function SortableHeader({
  label,
  column,
  active,
  direction,
  onSort,
}: {
  label: string;
  column: SortColumn;
  active: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  const isActive = active === column;
  return (
    <TableHead>
      <button type="button" onClick={() => onSort(column)} className="flex items-center gap-1 font-semibold">
        {label}
        {isActive ? (direction === "asc" ? "▲" : "▼") : null}
      </button>
    </TableHead>
  );
}

function stalenessBadgeVariant(staleness: StalenessBucket): "success" | "warning" | "destructive" {
  switch (staleness) {
    case "under_1_min":
    case "under_5_min":
      return "success";
    case "under_30_min":
      return "warning";
    case "under_4_hours":
    case "over_4_hours":
    case "never_synced":
      return "destructive";
    default:
      return "warning";
  }
}

function compareRows(a: TillSyncHealthRow, b: TillSyncHealthRow, column: SortColumn, direction: SortDirection): number {
  const sign = direction === "asc" ? 1 : -1;

  switch (column) {
    case "store":
      return sign * a.store_name.localeCompare(b.store_name);
    case "till":
      return sign * a.till_label.localeCompare(b.till_label);
    case "queue_depth":
      return sign * ((a.queue_depth ?? -1) - (b.queue_depth ?? -1));
    case "staleness":
      return sign * (STALENESS_ORDER[classifyStaleness(a.server_ts)] - STALENESS_ORDER[classifyStaleness(b.server_ts)]);
    default:
      return 0;
  }
}

function formatRelative(iso: string | null): string {
  if (iso === null) return "Never";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "Unknown";

  const minutes = Math.max(0, (Date.now() - at) / 60_000);
  if (minutes < 1) return "under a minute ago";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h ago`;
  return `${(hours / 24).toFixed(1)} d ago`;
}

