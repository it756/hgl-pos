"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { saveAvailability } from "../../app/(app)/catalog/actions";
import type { AvailabilityRow, SkuRow } from "../../lib/catalog/service";
import type { StoreOption } from "../../lib/catalog/options";
import { SELECT_CLASS } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Props = {
  skus: SkuRow[];
  stores: StoreOption[];
  storeId: string | null;
  availability: AvailabilityRow[];
  isHq: boolean;
};

type Draft = { is_stocked: boolean; reorder_point: string; reorder_qty: string };

function toDraft(row: AvailabilityRow | undefined): Draft {
  return {
    is_stocked: row?.is_stocked ?? false,
    reorder_point: row?.reorder_point === null || row?.reorder_point === undefined ? "" : String(row.reorder_point),
    reorder_qty: row?.reorder_qty === null || row?.reorder_qty === undefined ? "" : String(row.reorder_qty),
  };
}

function toNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function AvailabilityTab({ skus, stores, storeId, availability, isHq }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const existing = useMemo(() => new Map(availability.map((row) => [row.sku_id, row])), [availability]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState("");
  const [onlyRanged, setOnlyRanged] = useState(!isHq);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busy, startTransition] = useTransition();

  const term = search.trim().toLowerCase();
  const visible = skus.filter(
    (sku) =>
      sku.is_active &&
      (!onlyRanged || existing.has(sku.sku_id)) &&
      (term === "" || sku.code.toLowerCase().includes(term) || sku.name.toLowerCase().includes(term)),
  );

  function draftFor(skuId: string): Draft {
    return drafts[skuId] ?? toDraft(existing.get(skuId));
  }

  function update(skuId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [skuId]: { ...draftFor(skuId), ...patch } }));
  }

  function save(skuId: string) {
    if (storeId === null) return;
    const draft = draftFor(skuId);
    startTransition(async () => {
      const result = await saveAvailability(
        {
          store_id: storeId,
          sku_id: skuId,
          is_stocked: draft.is_stocked,
          reorder_point: toNumber(draft.reorder_point),
          reorder_qty: toNumber(draft.reorder_qty),
        },
        existing.has(skuId),
      );
      setMessages((current) => ({ ...current, [skuId]: result.error ?? "Saved" }));
      if (result.error === null) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[skuId];
          return next;
        });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-end gap-sm">
        {isHq && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="availability-store">Store</Label>
            <select
              id="availability-store"
              className={SELECT_CLASS}
              value={storeId ?? ""}
              onChange={(event) => router.push(`${pathname}?tab=availability&store=${event.target.value}` as Route)}
            >
              <option value="" disabled>
                Choose a store
              </option>
              {stores.map((store) => (
                <option key={store.store_id} value={store.store_id}>
                  {store.name} ({store.code})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor="availability-search">Search</Label>
          <Input id="availability-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or name" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-body-md font-body-md text-on-surface">
          <input type="checkbox" checked={onlyRanged} onChange={(event) => setOnlyRanged(event.target.checked)} />
          Only SKUs ranged in this store
        </label>
      </div>

      {storeId === null ? (
        <p className="text-body-md font-body-md text-on-surface-variant">Choose a store to manage its range and reorder levels.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Stocked</TableHead>
              <TableHead>Reorder point</TableHead>
              <TableHead>Reorder qty</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((sku) => {
              const ranged = existing.has(sku.sku_id);
              const locked = !isHq && !ranged;
              const draft = draftFor(sku.sku_id);
              return (
                <TableRow key={sku.sku_id}>
                  <TableCell>
                    <span className="font-medium text-on-surface">{sku.code}</span> · {sku.name}
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`${sku.code} stocked`}
                      disabled={locked}
                      checked={draft.is_stocked}
                      onChange={(event) => update(sku.sku_id, { is_stocked: event.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${sku.code} reorder point`}
                      type="number"
                      min={0}
                      step="0.001"
                      className="w-28"
                      disabled={locked}
                      value={draft.reorder_point}
                      onChange={(event) => update(sku.sku_id, { reorder_point: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${sku.code} reorder quantity`}
                      type="number"
                      min={0}
                      step="0.001"
                      className="w-28"
                      disabled={locked}
                      value={draft.reorder_qty}
                      onChange={(event) => update(sku.sku_id, { reorder_qty: event.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {locked ? (
                      <span className="text-body-sm text-on-surface-variant">Ask HQ to range this SKU</span>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        {messages[sku.sku_id] !== undefined && (
                          <span className={messages[sku.sku_id] === "Saved" ? "text-body-sm text-on-surface-variant" : "text-body-sm text-destructive"}>
                            {messages[sku.sku_id]}
                          </span>
                        )}
                        <Button type="button" size="sm" variant="outline" disabled={busy || drafts[sku.sku_id] === undefined} onClick={() => save(sku.sku_id)}>
                          {ranged ? "Save" : "Range in store"}
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-on-surface-variant">
                  No SKUs match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
