"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { approveAdjustment, rejectAdjustment, type PendingAdjustment, type SkuOption, type StoreOption } from "../lib/adjustments/service";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type AdjustmentsDashboardProps = {
  pending: PendingAdjustment[];
  skus: SkuOption[];
  stores: StoreOption[];
  currentUserId: string;
  canResolve: boolean;
};

export function AdjustmentsDashboard({ pending, skus, stores, currentUserId, canResolve }: AdjustmentsDashboardProps) {
  const router = useRouter();
  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);
  const storeById = useMemo(() => new Map(stores.map((store) => [store.store_id, store])), [stores]);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResolve(request: PendingAdjustment, action: "approve" | "reject") {
    setPendingId(request.adjustment_id);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (action === "approve") {
        await approveAdjustment(supabase, request, currentUserId);
      } else {
        await rejectAdjustment(supabase, request, currentUserId);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Stock adjustment requests</h1>
      <p className="text-body-md font-body-md text-on-surface-variant">
        Approving a request writes the adjusting stock movement immediately; rejecting leaves stock unchanged (FR-017).
      </p>

      {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Requested</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Reason</TableHead>
            {canResolve && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pending.map((request) => (
            <TableRow key={request.adjustment_id}>
              <TableCell>{new Date(request.requested_at).toLocaleString()}</TableCell>
              <TableCell>{storeById.get(request.store_id)?.name ?? request.store_id}</TableCell>
              <TableCell>{skuById.get(request.sku_id)?.name ?? request.sku_id}</TableCell>
              <TableCell>
                <Badge variant={request.delta_qty < 0 ? "destructive" : "success"}>
                  {request.delta_qty > 0 ? "+" : ""}
                  {request.delta_qty}
                </Badge>
              </TableCell>
              <TableCell>
                {request.reason_code}
                {request.notes !== null && <p className="text-on-surface-variant">{request.notes}</p>}
              </TableCell>
              {canResolve && (
                <TableCell className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pendingId === request.adjustment_id}
                    onClick={() => void handleResolve(request, "reject")}
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pendingId === request.adjustment_id}
                    onClick={() => void handleResolve(request, "approve")}
                  >
                    Approve
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {pending.length === 0 && (
            <TableRow>
              <TableCell colSpan={canResolve ? 6 : 5} className="text-center text-on-surface-variant">
                No pending adjustment requests.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
