"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import type { PriceAuditRow } from "../../lib/audit/price-audit";
import type { SkuOption, StoreOption } from "../../lib/catalog/options";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";

export type PriceAuditTableProps = {
  auditLog: PriceAuditRow[];
  skus: SkuOption[];
  stores: StoreOption[];
};

type EnrichedRow = PriceAuditRow & { sku_label: string; store_label: string };

export function PriceAuditTable({ auditLog, skus, stores }: PriceAuditTableProps) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "store">("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "server_ts", desc: true }]);

  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  const rows = useMemo<EnrichedRow[]>(() => {
    return auditLog
      .map((entry) => ({
        ...entry,
        sku_label: entry.sku_id !== null ? (skuById.get(entry.sku_id)?.code ?? entry.sku_id) : "—",
        store_label: entry.store_id !== null ? (storeById.get(entry.store_id)?.code ?? entry.store_id) : "Global",
      }))
      .filter((entry) => {
        if (scopeFilter === "global") return entry.store_id === null;
        if (scopeFilter === "store") return entry.store_id !== null;
        return true;
      });
  }, [auditLog, skuById, storeById, scopeFilter]);

  const columns = useMemo<ColumnDef<EnrichedRow>[]>(
    () => [
      {
        id: "server_ts",
        header: "Timestamp",
        accessorKey: "server_ts",
        cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString(),
      },
      {
        id: "actor_name",
        header: "Actor",
        accessorFn: (row) => row.actor_name ?? "Unknown",
      },
      {
        id: "sku_label",
        header: "SKU",
        accessorKey: "sku_label",
      },
      {
        id: "store_label",
        header: "Scope",
        accessorKey: "store_label",
      },
      {
        id: "change",
        header: "Old → New",
        accessorFn: (row) => `${row.old_unit_price ?? "—"} → ${row.new_unit_price ?? "—"}`,
      },
      {
        id: "effective_from",
        header: "Effective from",
        accessorFn: (row) => (row.effective_from !== null ? new Date(row.effective_from).toLocaleString() : "—"),
      },
      {
        id: "reason",
        header: "Reason",
        accessorFn: (row) => row.reason ?? "—",
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Price change audit</CardTitle>
        <div className="flex items-center gap-3">
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Search actor, SKU, reason…"
            className="w-64"
          />
          <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface-variant">
            Scope
            <select
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}
              className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1"
            >
              <option value="all">All</option>
              <option value="global">Global</option>
              <option value="store">Store-specific</option>
            </select>
          </label>
          <Badge variant="secondary">{table.getRowModel().rows.length} changes</Badge>
        </div>
      </CardHeader>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      className="flex items-center gap-1 font-semibold"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: "▲", desc: "▼" }[header.column.getIsSorted() as string] ?? null}
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
          {table.getRowModel().rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-4 text-center text-on-surface-variant">
                No price changes match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
