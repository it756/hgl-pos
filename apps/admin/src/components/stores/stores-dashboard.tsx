"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { saveStore } from "../../app/(app)/stores/actions";
import type { StoreRow } from "../../lib/stores/service";
import { INITIAL_ACTION_STATE } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function StoresDashboard({ stores }: { stores: StoreRow[] }) {
  const [editing, setEditing] = useState<StoreRow | "new" | null>(null);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Stores</h1>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          Add store
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Timezone</TableHead>
            <TableHead className="text-right">Offline alert (trading / overnight)</TableHead>
            <TableHead className="text-right">Tills</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {stores.map((store) => (
            <TableRow key={store.store_id}>
              <TableCell className="font-medium text-on-surface">{store.code}</TableCell>
              <TableCell>{store.name}</TableCell>
              <TableCell>{store.region ?? "—"}</TableCell>
              <TableCell>{store.timezone}</TableCell>
              <TableCell className="text-right">
                {store.offline_threshold_minutes_trading} / {store.offline_threshold_minutes_overnight} min
              </TableCell>
              <TableCell className="text-right">{store.till_count}</TableCell>
              <TableCell className="text-right">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(store)}>
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {stores.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-on-surface-variant">
                No stores yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent>
          {editing !== null && <StoreForm key={editing === "new" ? "new" : editing.store_id} store={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StoreForm({ store, onDone }: { store: StoreRow | null; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveStore, INITIAL_ACTION_STATE);

  useEffect(() => {
    if (state.success) {
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{store === null ? "Add store" : `Edit ${store.name}`}</SheetTitle>
      </SheetHeader>
      {store !== null && <input type="hidden" name="store_id" value={store.store_id} />}
      <Field id="code" label="Code" defaultValue={store?.code} required />
      <Field id="name" label="Name" defaultValue={store?.name} required />
      <Field id="region" label="Region" defaultValue={store?.region ?? ""} />
      <Field id="timezone" label="Timezone (IANA)" defaultValue={store?.timezone ?? "Africa/Lusaka"} required />
      <Field id="offline_threshold_minutes_trading" label="Offline alert threshold — trading hours (minutes)" type="number" defaultValue={String(store?.offline_threshold_minutes_trading ?? 240)} required />
      <Field id="offline_threshold_minutes_overnight" label="Offline alert threshold — overnight (minutes)" type="number" defaultValue={String(store?.offline_threshold_minutes_overnight ?? 1440)} required />
      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save store"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function Field({ id, label, defaultValue, type = "text", required = false }: { id: string; label: string; defaultValue?: string; type?: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`store-${id}`}>{label}</Label>
      <Input id={`store-${id}`} name={id} type={type} defaultValue={defaultValue} required={required} min={type === "number" ? 1 : undefined} />
    </div>
  );
}