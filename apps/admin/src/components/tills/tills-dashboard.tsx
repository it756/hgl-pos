"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Copy, Plus } from "lucide-react";
import { provisionTill, resetTillCredential, retireTill, type TillActionState } from "../../app/(app)/tills/actions";
import type { IssuedCredential, TillRow } from "../../lib/tills/service";
import type { StoreOption } from "../../lib/catalog/options";
import { SELECT_CLASS, formatDateTime } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type Props = { tills: TillRow[]; stores: StoreOption[]; canManage: boolean };

const INITIAL: TillActionState = { error: null, issued: null };

export function TillsDashboard({ tills, stores, canManage }: Props) {
  const storeName = useMemo(() => new Map(stores.map((store) => [store.store_id, store.name])), [stores]);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, startTransition] = useTransition();

  const visible = tills.filter((till) => showRetired || till.retired_at === null);

  function handleReset(till: TillRow) {
    if (!window.confirm(`Issue a new credential for ${till.label}? The till's current credential stops working immediately.`)) return;
    startTransition(async () => {
      const result = await resetTillCredential(till.till_id);
      setError(result.error);
      setIssued(result.issued);
    });
  }

  function handleRetire(till: TillRow) {
    const reason = window.prompt(`Retire ${till.label}? It will no longer be able to sync. Reason (required):`);
    if (reason === null) return;
    startTransition(async () => {
      const result = await retireTill(till.till_id, reason);
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Tills</h1>
        <div className="flex items-center gap-sm">
          <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface-variant">
            <input type="checkbox" checked={showRetired} onChange={(event) => setShowRetired(event.target.checked)} />
            Show retired
          </label>
          {canManage && (
            <Button type="button" onClick={() => setProvisionOpen(true)}>
              <Plus className="h-4 w-4" />
              Provision till
            </Button>
          )}
        </div>
      </div>

      {error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Till</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Device identity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last heartbeat</TableHead>
            <TableHead>App version</TableHead>
            <TableHead className="text-right">Queue</TableHead>
            {canManage && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((till) => (
            <TableRow key={till.till_id}>
              <TableCell className="font-medium text-on-surface">{till.label}</TableCell>
              <TableCell>{storeName.get(till.store_id) ?? till.store_id}</TableCell>
              <TableCell className="font-mono text-body-sm">{till.device_identity}</TableCell>
              <TableCell>
                {till.retired_at !== null ? (
                  <Badge variant="outline">Retired {new Date(till.retired_at).toLocaleDateString()}</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </TableCell>
              <TableCell>{formatDateTime(till.last_heartbeat_at)}</TableCell>
              <TableCell>{till.app_version ?? "—"}</TableCell>
              <TableCell className="text-right">{till.queue_depth ?? "—"}</TableCell>
              {canManage && (
                <TableCell className="flex justify-end gap-2">
                  {till.retired_at === null && (
                    <>
                      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => handleReset(till)}>
                        Reset credential
                      </Button>
                      <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => handleRetire(till)}>
                        Retire
                      </Button>
                    </>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={canManage ? 8 : 7} className="text-center text-on-surface-variant">
                No tills.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={provisionOpen} onOpenChange={setProvisionOpen}>
        <SheetContent>
          {provisionOpen && (
            <ProvisionForm
              stores={stores}
              onIssued={(credential) => {
                setProvisionOpen(false);
                setIssued(credential);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <SheetContent>{issued !== null && <CredentialReveal issued={issued} onClose={() => setIssued(null)} />}</SheetContent>
      </Sheet>
    </div>
  );
}

function ProvisionForm({ stores, onIssued }: { stores: StoreOption[]; onIssued: (issued: IssuedCredential) => void }) {
  const [state, formAction, pending] = useActionState(async (prev: TillActionState, formData: FormData) => {
    const result = await provisionTill(prev, formData);
    if (result.issued !== null) onIssued(result.issued);
    return result;
  }, INITIAL);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Provision till</SheetTitle>
      </SheetHeader>
      <p className="text-body-md font-body-md text-on-surface-variant">
        The till needs live connectivity for its first sync (FR-039). Enter the credential on the device during setup.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="till-store">Store</Label>
        <select id="till-store" name="store_id" className={SELECT_CLASS} defaultValue={stores[0]?.store_id}>
          {stores.map((store) => (
            <option key={store.store_id} value={store.store_id}>
              {store.name} ({store.code})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="till-label">Label</Label>
        <Input id="till-label" name="label" placeholder="e.g. TILL-03" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="till-device">Device identity</Label>
        <Input id="till-device" name="device_identity" placeholder="hostname or hardware serial" required />
      </div>
      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Provisioning…" : "Provision"}
        </Button>
      </SheetFooter>
    </form>
  );
}

function CredentialReveal({ issued, onClose }: { issued: IssuedCredential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Device credential</SheetTitle>
      </SheetHeader>
      <p role="alert" className="rounded-lg bg-amber-100 p-sm text-body-md font-body-md text-amber-900">
        This credential is shown once and is not stored anywhere readable. Copy it to the till now.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label>Till ID</Label>
        <code className="break-all rounded bg-surface-container-low p-2 text-body-sm">{issued.tillId}</code>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Credential</Label>
        <code data-testid="till-credential" className="break-all rounded bg-surface-container-low p-2 text-body-sm">
          {issued.credential}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(issued.credential).then(() => setCopied(true));
          }}
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy credential"}
        </Button>
      </div>
      <p className="text-body-md font-body-md text-on-surface-variant">Expires {formatDateTime(issued.expiresAt)}.</p>
      <SheetFooter>
        <Button type="button" onClick={onClose}>
          I&apos;ve saved it
        </Button>
      </SheetFooter>
    </div>
  );
}