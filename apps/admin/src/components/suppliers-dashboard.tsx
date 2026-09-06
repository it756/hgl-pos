"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSupplier,
  linkSkuToSupplier,
  setSupplierActive,
  type SkuOption,
  type SkuSupplierLink,
  type SupplierRow,
} from "../lib/suppliers/service";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type SuppliersDashboardProps = {
  suppliers: SupplierRow[];
  links: SkuSupplierLink[];
  skus: SkuOption[];
  canManage: boolean;
};

export function SuppliersDashboard({ suppliers, links, skus, canManage }: SuppliersDashboardProps) {
  const router = useRouter();
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.supplier_id, supplier])), [suppliers]);
  const skuById = useMemo(() => new Map(skus.map((sku) => [sku.sku_id, sku])), [skus]);

  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleActive(supplier: SupplierRow) {
    setPendingSupplierId(supplier.supplier_id);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      await setSupplierActive(supabase, supplier.supplier_id, !supplier.is_active);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingSupplierId(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Suppliers</h1>
        {canManage && (
          <Sheet open={createOpen} onOpenChange={setCreateOpen}>
            <SheetTrigger asChild>
              <Button type="button">Add supplier</Button>
            </SheetTrigger>
            <SheetContent>
              <CreateSupplierForm
                onCreated={() => {
                  setCreateOpen(false);
                  router.refresh();
                }}
                onError={setError}
              />
            </SheetContent>
          </Sheet>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Directory ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.supplier_id}>
                  <TableCell className="font-medium text-on-surface">{supplier.code}</TableCell>
                  <TableCell>{supplier.name}</TableCell>
                  <TableCell>{supplier.contact_name ?? "—"}</TableCell>
                  <TableCell>{supplier.phone ?? "—"}</TableCell>
                  <TableCell>{supplier.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={supplier.is_active ? "success" : "outline"}>{supplier.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="flex justify-end">
                      <Button
                        type="button"
                        variant={supplier.is_active ? "destructive" : "secondary"}
                        size="sm"
                        disabled={pendingSupplierId === supplier.supplier_id}
                        onClick={() => void handleToggleActive(supplier)}
                      >
                        {supplier.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {suppliers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 6} className="text-center text-on-surface-variant">
                    No suppliers yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>SKU ↔ supplier links ({links.length})</CardTitle>
          {canManage && (
            <Sheet open={linkOpen} onOpenChange={setLinkOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Link SKU
                </Button>
              </SheetTrigger>
              <SheetContent>
                <LinkSkuSupplierForm
                  suppliers={suppliers}
                  skus={skus}
                  onLinked={() => {
                    setLinkOpen(false);
                    router.refresh();
                  }}
                  onError={setError}
                />
              </SheetContent>
            </Sheet>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Supplier SKU code</TableHead>
                <TableHead>Primary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={`${link.sku_id}:${link.supplier_id}`}>
                  <TableCell>{skuById.get(link.sku_id)?.name ?? link.sku_id}</TableCell>
                  <TableCell>{supplierById.get(link.supplier_id)?.name ?? link.supplier_id}</TableCell>
                  <TableCell>{link.supplier_sku_code ?? "—"}</TableCell>
                  <TableCell>{link.is_primary && <Badge variant="secondary">Primary</Badge>}</TableCell>
                </TableRow>
              ))}
              {links.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-on-surface-variant">
                    No SKU-supplier links yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

type CreateSupplierFormProps = {
  onCreated: () => void;
  onError: (message: string) => void;
};

function CreateSupplierForm({ onCreated, onError }: CreateSupplierFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit() {
    if (code.trim().length === 0 || name.trim().length === 0) {
      setValidationError("Code and name are required.");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await createSupplier(supabase, {
        code: code.trim(),
        name: name.trim(),
        contactName: contactName.trim().length > 0 ? contactName.trim() : null,
        phone: phone.trim().length > 0 ? phone.trim() : null,
        email: email.trim().length > 0 ? email.trim() : null,
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Add supplier</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-code">Code</Label>
          <Input id="supplier-code" value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-name">Name</Label>
          <Input id="supplier-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-contact">Contact name</Label>
          <Input id="supplier-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-phone">Phone</Label>
          <Input id="supplier-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="supplier-email">Email</Label>
          <Input id="supplier-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>

        {validationError !== null && <p className="text-body-md font-body-md text-destructive">{validationError}</p>}
      </div>

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create supplier"}
        </Button>
      </SheetFooter>
    </div>
  );
}

type LinkSkuSupplierFormProps = {
  suppliers: SupplierRow[];
  skus: SkuOption[];
  onLinked: () => void;
  onError: (message: string) => void;
};

function LinkSkuSupplierForm({ suppliers, skus, onLinked, onError }: LinkSkuSupplierFormProps) {
  const [skuId, setSkuId] = useState(skus[0]?.sku_id ?? "");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.supplier_id ?? "");
  const [supplierSkuCode, setSupplierSkuCode] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit() {
    if (skuId === "" || supplierId === "") {
      setValidationError("SKU and supplier are required.");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await linkSkuToSupplier(supabase, {
        skuId,
        supplierId,
        supplierSkuCode: supplierSkuCode.trim().length > 0 ? supplierSkuCode.trim() : null,
        isPrimary,
      });
      onLinked();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Link SKU to supplier</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-sku">SKU</Label>
          <select
            id="link-sku"
            value={skuId}
            onChange={(event) => setSkuId(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
          >
            {skus.map((sku) => (
              <option key={sku.sku_id} value={sku.sku_id}>
                {sku.code} — {sku.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-supplier">Supplier</Label>
          <select
            id="link-supplier"
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
          >
            {suppliers.map((supplier) => (
              <option key={supplier.supplier_id} value={supplier.supplier_id}>
                {supplier.code} — {supplier.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="link-supplier-sku-code">Supplier SKU code (optional)</Label>
          <Input id="link-supplier-sku-code" value={supplierSkuCode} onChange={(event) => setSupplierSkuCode(event.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          Primary supplier for this SKU
        </label>

        {validationError !== null && <p className="text-body-md font-body-md text-destructive">{validationError}</p>}
      </div>

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Linking…" : "Link SKU"}
        </Button>
      </SheetFooter>
    </div>
  );
}
