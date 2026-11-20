"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createAdjustment } from "../../app/(app)/adjustments/actions";
import { REASON_CODES, type AdjustmentHistoryRow, type SkuOption, type StoreOption } from "../../lib/adjustments/service";
import { INITIAL_ACTION_STATE, SELECT_CLASS, TEXTAREA_CLASS, formatDateTime, formatQty } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function NewAdjustmentButton({ skus, threshold }: { skus: SkuOption[]; threshold: number }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-sm">
      {notice !== null && (
        <p role="status" className="text-body-md text-on-surface-variant">
          {notice}
        </p>
      )}
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New adjustment
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          {open && (
            <NewAdjustmentForm
              skus={skus}
              threshold={threshold}
              onDone={(message) => {
                setOpen(false);
                setNotice(message);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NewAdjustmentForm({ skus, threshold, onDone }: { skus: SkuOption[]; threshold: number; onDone: (message: string) => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createAdjustment, INITIAL_ACTION_STATE);
  const [qty, setQty] = useState("");
  useEffect(() => {
    if (state.success) {
      onDone(state.message ?? "Saved.");
      router.refresh();
    }
  }, [state, onDone, router]);
  const numericQty = Number(qty);
  const willNeedApproval = qty !== "" && Number.isFinite(numericQty) && Math.abs(numericQty) > threshold;

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>New stock adjustment</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adjustment-sku">SKU</Label>
        <select id="adjustment-sku" name="sku_id" className={SELECT_CLASS} defaultValue="" required>
          <option value="" disabled>
            Choose a SKU
          </option>
          {skus.map((sku) => (
            <option key={sku.sku_id} value={sku.sku_id}>
              {sku.code} · {sku.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adjustment-qty">Quantity change (negative removes stock)</Label>
        <Input id="adjustment-qty" name="delta_qty" type="number" step="0.001" value={qty} onChange={(event) => setQty(event.target.value)} required />
        <p className="text-body-sm text-on-surface-variant">
          {willNeedApproval ? `Above the ${threshold} threshold — will need manager approval.` : `Up to ±${threshold} is applied immediately.`}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adjustment-reason">Reason</Label>
        <select id="adjustment-reason" name="reason_code" className={SELECT_CLASS} defaultValue="" required>
          <option value="" disabled>
            Choose a reason
          </option>
          {REASON_CODES.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {reason.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="adjustment-notes">Notes</Label>
        <textarea id="adjustment-notes" name="notes" className={TEXTAREA_CLASS} maxLength={500} />
      </div>
      {state.error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {state.error}
        </p>
      )}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Submit adjustment"}
        </Button>
      </SheetFooter>
    </form>
  );
}

type HistoryProps = { history: AdjustmentHistoryRow[]; skus: SkuOption[]; stores: StoreOption[]; userNames: Record<string, string> };

export function AdjustmentHistory({ history, skus, stores, userNames }: HistoryProps) {
  const [filter, setFilter] = useState<"all" | "approved" | "rejected" | "pending">("all");
  const skuName = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, `${sku.code} · ${sku.name}`])), [skus]);
  const storeName = useMemo(() => new Map(stores.map((store) => [store.store_id, store.name])), [stores]);
  const reasonLabel = new Map<string, string>(REASON_CODES.map((reason) => [reason.code, reason.label]));
  const visible = history.filter((row) => filter === "all" || row.outcome === filter);

  return (
    <section aria-labelledby="adjustment-history" className="flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <h2 id="adjustment-history" className="text-headline-md font-headline-md font-semibold text-on-surface">
          History
        </h2>
        <select aria-label="Filter history" className={`${SELECT_CLASS} w-48`} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Requested</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested by</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Resolved by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.adjustment_id}>
              <TableCell>{formatDateTime(row.requested_at)}</TableCell>
              <TableCell>{storeName.get(row.store_id) ?? row.store_id}</TableCell>
              <TableCell>{skuName.get(row.sku_id) ?? row.sku_id}</TableCell>
              <TableCell className="text-right">
                {row.delta_qty > 0 ? "+" : ""}
                {formatQty(row.delta_qty)}
              </TableCell>
              <TableCell>
                {reasonLabel.get(row.reason_code) ?? row.reason_code}
                {row.notes !== null && <p className="text-body-sm text-on-surface-variant">{row.notes}</p>}
              </TableCell>
              <TableCell>{userNames[row.requested_by_user_id] ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={row.outcome === "approved" ? "success" : row.outcome === "rejected" ? "destructive" : "warning"}>{row.outcome}</Badge>
              </TableCell>
              <TableCell>
                {row.approver_user_id === null ? "—" : (userNames[row.approver_user_id] ?? "—")}
                {row.resolved_at !== null && <p className="text-body-sm text-on-surface-variant">{formatDateTime(row.resolved_at)}</p>}
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-on-surface-variant">
                No adjustments.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}
