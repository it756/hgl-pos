"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addBarcode, removeBarcode, saveSku, setPrimaryBarcode, setSkuActive } from "../../app/(app)/catalog/actions";
import type { CategoryRow, SkuRow } from "../../lib/catalog/service";
import { INITIAL_ACTION_STATE, SELECT_CLASS } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Props = { skus: SkuRow[]; categories: CategoryRow[]; canEdit: boolean };

export function SkusTab({ skus, categories, canEdit }: Props) {
  const router = useRouter();
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.category_id, c.name])), [categories]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<SkuRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const term = search.trim().toLowerCase();
  const visible = skus.filter(
    (sku) =>
      (status === "all" || sku.is_active === (status === "active")) &&
      (categoryFilter === "" || sku.category_id === categoryFilter) &&
      (term === "" ||
        sku.code.toLowerCase().includes(term) ||
        sku.name.toLowerCase().includes(term) ||
        sku.barcodes.some((barcode) => barcode.barcode.includes(term))),
  );
  const editingSku = editing === "new" || editing === null ? editing : (skus.find((sku) => sku.sku_id === editing.sku_id) ?? null);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-end gap-sm">
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor="sku-search">Search</Label>
          <Input id="sku-search" placeholder="Code, name or barcode" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku-category-filter">Category</Label>
          <select id="sku-category-filter" className={SELECT_CLASS} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.category_id} value={category.category_id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sku-status-filter">Status</Label>
          <select id="sku-status-filter" className={SELECT_CLASS} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Add SKU
          </Button>
        )}
      </div>

      {error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{error}</p>}
      <p className="text-body-sm font-body-sm text-on-surface-variant">{visible.length} of {skus.length} SKUs</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Primary barcode</TableHead>
            <TableHead>Tracking</TableHead>
            <TableHead>Status</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((sku) => (
            <TableRow key={sku.sku_id}>
              <TableCell className="font-medium text-on-surface">{sku.code}</TableCell>
              <TableCell>{sku.name}</TableCell>
              <TableCell>{sku.category_id === null ? "—" : (categoryName.get(sku.category_id) ?? "—")}</TableCell>
              <TableCell className="capitalize">{sku.unit_type}</TableCell>
              <TableCell className="font-mono text-body-sm">{sku.barcodes.find((b) => b.is_primary)?.barcode ?? sku.barcode ?? "—"}</TableCell>
              <TableCell>
                {[sku.track_batch && "batch", sku.track_expiry && "expiry"].filter(Boolean).join(", ") || "—"}
              </TableCell>
              <TableCell>
                <Badge variant={sku.is_active ? "success" : "outline"}>{sku.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              {canEdit && (
                <TableCell className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(sku)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant={sku.is_active ? "destructive" : "secondary"}
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setSkuActive(sku.sku_id, !sku.is_active);
                        setError(result.error);
                        router.refresh();
                      })
                    }
                  >
                    {sku.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 8 : 7} className="text-center text-on-surface-variant">
                No SKUs match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={editingSku !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="overflow-y-auto">
          {editingSku !== null && (
            <div className="flex flex-col gap-md">
              <SkuForm key={editingSku === "new" ? "new" : editingSku.sku_id} sku={editingSku === "new" ? null : editingSku} categories={categories} onSaved={() => setEditing(null)} />
              {editingSku !== "new" && <BarcodeManager sku={editingSku} />}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SkuForm({ sku, categories, onSaved }: { sku: SkuRow | null; categories: CategoryRow[]; onSaved: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSku, INITIAL_ACTION_STATE);
  useEffect(() => {
    if (state.success) {
      if (sku === null) onSaved();
      router.refresh();
    }
  }, [state, sku, onSaved, router]);

  return (
    <form action={formAction} className="flex flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{sku === null ? "Add SKU" : `Edit ${sku.code}`}</SheetTitle>
      </SheetHeader>
      {sku !== null && <input type="hidden" name="sku_id" value={sku.sku_id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sku-code">Code</Label>
        <Input id="sku-code" name="code" defaultValue={sku?.code} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sku-name">Name</Label>
        <Input id="sku-name" name="name" defaultValue={sku?.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sku-category">Category</Label>
        <select id="sku-category" name="category_id" className={SELECT_CLASS} defaultValue={sku?.category_id ?? ""}>
          <option value="">— None —</option>
          {categories
            .filter((category) => category.is_active || category.category_id === sku?.category_id)
            .map((category) => (
              <option key={category.category_id} value={category.category_id}>
                {category.name} ({category.code})
              </option>
            ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sku-unit">Unit type</Label>
        <select id="sku-unit" name="unit_type" className={SELECT_CLASS} defaultValue={sku?.unit_type ?? "quantity"}>
          <option value="quantity">Quantity (each)</option>
          <option value="weight">Weight (kg)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface">
        <input type="checkbox" name="track_batch" defaultChecked={sku?.track_batch ?? false} />
        Track batch numbers
      </label>
      <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface">
        <input type="checkbox" name="track_expiry" defaultChecked={sku?.track_expiry ?? false} />
        Track expiry dates
      </label>
      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      {state.success && sku !== null && <p role="status" className="text-body-md font-body-md text-on-surface-variant">Saved.</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save SKU"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function BarcodeManager({ sku }: { sku: SkuRow }) {
  const router = useRouter();
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (result.error === null) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="barcodes-heading" className="flex flex-col gap-sm border-t border-outline-variant pt-md">
      <h3 id="barcodes-heading" className="text-body-lg font-body-lg font-semibold text-on-surface">
        Barcodes
      </h3>
      <ul className="flex flex-col gap-1">
        {sku.barcodes.map((entry) => (
          <li key={entry.barcode} className="flex items-center justify-between gap-2">
            <span className="font-mono text-body-md">
              {entry.barcode} {entry.is_primary && <Badge variant="secondary">Primary</Badge>}
            </span>
            <span className="flex gap-1">
              {!entry.is_primary && (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(() => setPrimaryBarcode(sku.sku_id, entry.barcode))}>
                  Make primary
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(() => removeBarcode(sku.sku_id, entry.barcode))}>
                Remove
              </Button>
            </span>
          </li>
        ))}
        {sku.barcodes.length === 0 && <li className="text-body-md text-on-surface-variant">No barcodes yet.</li>}
      </ul>
      <div className="flex gap-2">
        <Input aria-label="New barcode" placeholder="Scan or type a barcode" value={barcode} onChange={(event) => setBarcode(event.target.value)} />
        <Button
          type="button"
          variant="outline"
          disabled={busy || barcode.trim() === ""}
          onClick={() => run(() => addBarcode(sku.sku_id, barcode, sku.barcodes.length === 0), () => setBarcode(""))}
        >
          Add
        </Button>
      </div>
      {error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{error}</p>}
    </section>
  );
}
