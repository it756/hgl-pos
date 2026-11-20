"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveCustomer, saveTier, setCustomerActive, setTierActive } from "../../app/(app)/customers/actions";
import type { CustomerRow, LoyaltyTier } from "../../lib/customers/service";
import type { StoreOption } from "../../lib/catalog/options";
import { INITIAL_ACTION_STATE, SELECT_CLASS, TEXTAREA_CLASS, formatMoney } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function useSuccess(success: boolean, onDone: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (success) {
      onDone();
      router.refresh();
    }
  }, [success, onDone, router]);
}

type CustomersProps = { customers: CustomerRow[]; tiers: LoyaltyTier[]; stores: StoreOption[] };

export function CustomersTable({ customers, tiers, stores }: CustomersProps) {
  const router = useRouter();
  const tierName = new Map(tiers.map((tier) => [tier.tier_id, tier.name]));
  const storeName = new Map(stores.map((store) => [store.store_id, store.name]));
  const [editing, setEditing] = useState<CustomerRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-md">
      <div>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          Add customer
        </Button>
      </div>
      {error !== null && <p role="alert" className="text-body-md text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Credit limit</TableHead>
            <TableHead>Home store</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer.customer_id}>
              <TableCell className="font-medium text-on-surface">{customer.full_name}</TableCell>
              <TableCell>{customer.phone ?? "—"}</TableCell>
              <TableCell>{customer.email ?? "—"}</TableCell>
              <TableCell>{customer.loyalty_tier_id === null ? "—" : (tierName.get(customer.loyalty_tier_id) ?? "—")}</TableCell>
              <TableCell className="text-right">{customer.credit_limit === null ? "No credit" : formatMoney(customer.credit_limit)}</TableCell>
              <TableCell>{customer.home_store_id === null ? "—" : (storeName.get(customer.home_store_id) ?? "—")}</TableCell>
              <TableCell>
                <Badge variant={customer.is_active ? "success" : "outline"}>{customer.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(customer)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={customer.is_active ? "destructive" : "secondary"}
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await setCustomerActive(customer.customer_id, !customer.is_active);
                      setError(result.error);
                      router.refresh();
                    })
                  }
                >
                  {customer.is_active ? "Deactivate" : "Activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {customers.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-on-surface-variant">
                No customers found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent className="overflow-y-auto">
          {editing !== null && (
            <CustomerForm
              key={editing === "new" ? "new" : editing.customer_id}
              customer={editing === "new" ? null : editing}
              tiers={tiers}
              stores={stores}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CustomerForm({ customer, tiers, stores, onDone }: { customer: CustomerRow | null; tiers: LoyaltyTier[]; stores: StoreOption[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(saveCustomer, INITIAL_ACTION_STATE);
  useSuccess(state.success, onDone);
  return (
    <form action={formAction} className="flex flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{customer === null ? "Add customer" : `Edit ${customer.full_name}`}</SheetTitle>
      </SheetHeader>
      {customer !== null && <input type="hidden" name="customer_id" value={customer.customer_id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-name">Full name</Label>
        <Input id="customer-name" name="full_name" defaultValue={customer?.full_name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-phone">Phone</Label>
        <Input id="customer-phone" name="phone" type="tel" defaultValue={customer?.phone ?? ""} placeholder="+260 97 1234567" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-email">Email</Label>
        <Input id="customer-email" name="email" type="email" defaultValue={customer?.email ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-tier">Loyalty tier</Label>
        <select id="customer-tier" name="loyalty_tier_id" className={SELECT_CLASS} defaultValue={customer?.loyalty_tier_id ?? ""}>
          <option value="">— None —</option>
          {tiers
            .filter((tier) => tier.is_active || tier.tier_id === customer?.loyalty_tier_id)
            .map((tier) => (
              <option key={tier.tier_id} value={tier.tier_id}>
                {tier.name}
              </option>
            ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-credit">Credit limit (ZMW, blank = no credit account)</Label>
        <Input id="customer-credit" name="credit_limit" type="number" min={0} step="0.01" defaultValue={customer?.credit_limit ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-store">Home store</Label>
        <select id="customer-store" name="home_store_id" className={SELECT_CLASS} defaultValue={customer?.home_store_id ?? ""}>
          <option value="">— None —</option>
          {stores.map((store) => (
            <option key={store.store_id} value={store.store_id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="customer-notes">Notes</Label>
        <textarea id="customer-notes" name="notes" className={TEXTAREA_CLASS} defaultValue={customer?.notes ?? ""} maxLength={1000} />
      </div>
      {state.error !== null && <p role="alert" className="text-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save customer"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function TiersTable({ tiers, canEdit, customerCounts }: { tiers: LoyaltyTier[]; canEdit: boolean; customerCounts: Record<string, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<LoyaltyTier | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-md text-on-surface-variant">Tier codes are what loyalty-tier promotions target.</p>
      {canEdit && (
        <div>
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" />
            Add tier
          </Button>
        </div>
      )}
      {error !== null && <p role="alert" className="text-body-md text-destructive">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Customers</TableHead>
            <TableHead>Status</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tiers.map((tier) => (
            <TableRow key={tier.tier_id}>
              <TableCell>{tier.rank}</TableCell>
              <TableCell className="font-medium text-on-surface">{tier.code}</TableCell>
              <TableCell>{tier.name}</TableCell>
              <TableCell className="text-right">{customerCounts[tier.tier_id] ?? 0}</TableCell>
              <TableCell>
                <Badge variant={tier.is_active ? "success" : "outline"}>{tier.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              {canEdit && (
                <TableCell className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(tier)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tier.is_active ? "destructive" : "secondary"}
                    disabled={busy}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await setTierActive(tier.tier_id, !tier.is_active);
                        setError(result.error);
                        router.refresh();
                      })
                    }
                  >
                    {tier.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {tiers.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 6 : 5} className="text-center text-on-surface-variant">
                No loyalty tiers yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent>
          {editing !== null && <TierForm key={editing === "new" ? "new" : editing.tier_id} tier={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TierForm({ tier, onDone }: { tier: LoyaltyTier | null; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(saveTier, INITIAL_ACTION_STATE);
  useSuccess(state.success, onDone);
  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{tier === null ? "Add tier" : `Edit ${tier.name}`}</SheetTitle>
      </SheetHeader>
      {tier !== null && <input type="hidden" name="tier_id" value={tier.tier_id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tier-code">Code</Label>
        <Input id="tier-code" name="code" defaultValue={tier?.code} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tier-name">Name</Label>
        <Input id="tier-name" name="name" defaultValue={tier?.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tier-rank">Rank (higher = better)</Label>
        <Input id="tier-rank" name="rank" type="number" min={0} step={1} defaultValue={tier?.rank ?? 0} />
      </div>
      {state.error !== null && <p role="alert" className="text-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save tier"}
        </Button>
      </SheetFooter>
    </form>
  );
}
