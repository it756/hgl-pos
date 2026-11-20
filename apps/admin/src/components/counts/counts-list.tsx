"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { startCount } from "../../app/(app)/counts/actions";
import type { CountSummary } from "../../lib/counts/service";
import type { StoreOption } from "../../lib/catalog/options";
import { INITIAL_ACTION_STATE, SELECT_CLASS, TEXTAREA_CLASS, formatDateTime } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Category = { category_id: string; name: string };
type Props = { counts: CountSummary[]; stores: StoreOption[]; categories: Category[]; isHq: boolean };

export const COUNT_STATUS_VARIANT = { open: "warning", submitted: "success", cancelled: "outline" } as const;

export function CountsList({ counts, stores, categories, isHq }: Props) {
  const [open, setOpen] = useState(false);
  const storeName = new Map(stores.map((store) => [store.store_id, store.name]));
  const categoryName = new Map(categories.map((category) => [category.category_id, category.name]));

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Stock counts</h1>
          <p className="text-body-md font-body-md text-on-surface-variant">
            Cycle counts post <code>count_correction</code> stock events, reported separately from shrinkage (FR-016).
          </p>
        </div>
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Start count
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Started by</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {counts.map((count) => (
            <TableRow key={count.count_id}>
              <TableCell>{formatDateTime(count.created_at)}</TableCell>
              <TableCell>{storeName.get(count.store_id) ?? count.store_id}</TableCell>
              <TableCell>{count.category_id === null ? "All stocked SKUs" : (categoryName.get(count.category_id) ?? "Category")}</TableCell>
              <TableCell>{count.created_by_name ?? "—"}</TableCell>
              <TableCell className="text-right">
                {count.lines_counted} / {count.lines_total}
              </TableCell>
              <TableCell>
                <Badge variant={COUNT_STATUS_VARIANT[count.status]}>{count.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/counts/${count.count_id}` as Route} className="text-body-md font-medium text-primary hover:underline">
                  {count.status === "open" ? "Continue" : "View"}
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {counts.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-on-surface-variant">
                No stock counts yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>{open && <StartCountForm stores={stores} categories={categories} isHq={isHq} />}</SheetContent>
      </Sheet>
    </div>
  );
}

function StartCountForm({ stores, categories, isHq }: Omit<Props, "counts">) {
  const [state, formAction, pending] = useActionState(startCount, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Start stock count</SheetTitle>
      </SheetHeader>
      <p className="text-body-md font-body-md text-on-surface-variant">
        Expected quantities are snapshotted now. You can keep trading while counting — corrections are computed against stock at the moment
        you submit.
      </p>
      {isHq && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="count-store">Store</Label>
          <select id="count-store" name="store_id" className={SELECT_CLASS} defaultValue={stores[0]?.store_id}>
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.name} ({store.code})
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="count-category">Scope</Label>
        <select id="count-category" name="category_id" className={SELECT_CLASS} defaultValue="">
          <option value="">All stocked SKUs</option>
          {categories.map((category) => (
            <option key={category.category_id} value={category.category_id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="count-notes">Notes</Label>
        <textarea id="count-notes" name="notes" className={TEXTAREA_CLASS} maxLength={500} />
      </div>
      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start count"}
        </Button>
      </SheetFooter>
    </form>
  );
}
