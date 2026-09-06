"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  createCashier,
  resetCashierPin,
  setUserActive,
  updateCashierProfile,
  type StoreOption,
  type UserRow,
} from "../lib/users/service";
import { getSupabaseBrowserClient } from "../lib/supabase/browser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type UsersDashboardProps = {
  users: UserRow[];
  stores: StoreOption[];
  scope: "hq_admin" | "store_manager";
};

const PIN_PATTERN = /^\d{4,8}$/;

export function UsersDashboard({ users, stores, scope }: UsersDashboardProps) {
  const router = useRouter();
  const storeNameById = useMemo(() => new Map(stores.map((store) => [store.store_id, store.name])), [stores]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleActive(user: UserRow) {
    setPendingUserId(user.user_id);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      await setUserActive(supabase, user.user_id, !user.is_active);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Users</h1>
        {scope === "hq_admin" && (
          <Sheet open={createOpen} onOpenChange={setCreateOpen}>
            <SheetTrigger asChild>
              <Button type="button">
                <UserPlus className="h-4 w-4" />
                Add cashier
              </Button>
            </SheetTrigger>
            <SheetContent>
              <CreateCashierForm
                stores={stores}
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

      {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>PIN last set</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.user_id}>
              <TableCell className="font-medium text-on-surface">{user.full_name}</TableCell>
              <TableCell className="capitalize">{user.role.replace("_", " ")}</TableCell>
              <TableCell>{user.store_id !== null ? (storeNameById.get(user.store_id) ?? user.store_id) : "—"}</TableCell>
              <TableCell>
                <Badge variant={user.is_active ? "success" : "outline"}>{user.is_active ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell>{new Date(user.pin_updated_at).toLocaleDateString()}</TableCell>
              <TableCell className="flex justify-end gap-2">
                {scope === "hq_admin" && user.role === "cashier" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditUser(user)}>
                    Edit
                  </Button>
                )}
                <Button
                  type="button"
                  variant={user.is_active ? "destructive" : "secondary"}
                  size="sm"
                  disabled={pendingUserId === user.user_id}
                  onClick={() => void handleToggleActive(user)}
                >
                  {user.is_active ? "Deactivate" : "Activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-on-surface-variant">
                No users found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={editUser !== null} onOpenChange={(open) => !open && setEditUser(null)}>
        <SheetContent>
          {editUser !== null && (
            <EditCashierForm
              user={editUser}
              stores={stores}
              onSaved={() => {
                setEditUser(null);
                router.refresh();
              }}
              onError={setError}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

type CreateCashierFormProps = {
  stores: StoreOption[];
  onCreated: () => void;
  onError: (message: string) => void;
};

function CreateCashierForm({ stores, onCreated, onError }: CreateCashierFormProps) {
  const [fullName, setFullName] = useState("");
  const [storeId, setStoreId] = useState(stores[0]?.store_id ?? "");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit() {
    if (fullName.trim().length === 0 || storeId === "") {
      setValidationError("Name and store are required.");
      return;
    }
    if (!PIN_PATTERN.test(pin)) {
      setValidationError("PIN must be 4-8 digits.");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await createCashier(supabase, { fullName: fullName.trim(), storeId, pin });
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
        <SheetTitle>Add cashier</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cashier-name">Full name</Label>
          <Input id="new-cashier-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cashier-store">Store</Label>
          <select
            id="new-cashier-store"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md text-on-surface"
          >
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.name} ({store.code})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-cashier-pin">PIN (4-8 digits)</Label>
          <Input
            id="new-cashier-pin"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          />
        </div>

        {validationError !== null && <p className="text-body-md font-body-md text-destructive">{validationError}</p>}
      </div>

      <SheetFooter>
        <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create cashier"}
        </Button>
      </SheetFooter>
    </div>
  );
}

type EditCashierFormProps = {
  user: UserRow;
  stores: StoreOption[];
  onSaved: () => void;
  onError: (message: string) => void;
};

function EditCashierForm({ user, stores, onSaved, onError }: EditCashierFormProps) {
  const [fullName, setFullName] = useState(user.full_name);
  const [storeId, setStoreId] = useState(user.store_id ?? stores[0]?.store_id ?? "");
  const [newPin, setNewPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSaveProfile() {
    if (fullName.trim().length === 0 || storeId === "") {
      setValidationError("Name and store are required.");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await updateCashierProfile(supabase, user.user_id, { fullName: fullName.trim(), storeId });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPin() {
    if (!PIN_PATTERN.test(newPin)) {
      setValidationError("PIN must be 4-8 digits.");
      return;
    }

    setValidationError(null);
    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await resetCashierPin(supabase, user.user_id, newPin);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Edit {user.full_name}</SheetTitle>
      </SheetHeader>

      <div className="flex flex-col gap-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-cashier-name">Full name</Label>
          <Input id="edit-cashier-name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-cashier-store">Store</Label>
          <select
            id="edit-cashier-store"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md text-on-surface"
          >
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.name} ({store.code})
              </option>
            ))}
          </select>
        </div>

        <Button type="button" variant="outline" disabled={submitting} onClick={() => void handleSaveProfile()}>
          Save profile
        </Button>

        <hr className="border-outline-variant" />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-cashier-pin">Reset PIN (4-8 digits)</Label>
          <Input
            id="edit-cashier-pin"
            inputMode="numeric"
            value={newPin}
            onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))}
          />
        </div>

        {validationError !== null && <p className="text-body-md font-body-md text-destructive">{validationError}</p>}
      </div>

      <SheetFooter>
        <Button type="button" variant="secondary" disabled={submitting} onClick={() => void handleResetPin()}>
          {submitting ? "Saving…" : "Reset PIN"}
        </Button>
      </SheetFooter>
    </div>
  );
}
