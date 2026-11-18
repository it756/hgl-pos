"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteStaff, updateStaff } from "../../app/(app)/users/actions";
import { INITIAL_ACTION_STATE, SELECT_CLASS } from "../../lib/format";
import type { StoreOption, UserRow } from "../../lib/users/service";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";

type RoleAndStoreProps = { stores: StoreOption[]; defaultRole: string; defaultStoreId: string | null; idPrefix: string };

function RoleAndStore({ stores, defaultRole, defaultStoreId, idPrefix }: RoleAndStoreProps) {
  const [role, setRole] = useState(defaultRole);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-role`}>Role</Label>
        <select id={`${idPrefix}-role`} name="role" className={SELECT_CLASS} value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="store_manager">Store manager</option>
          <option value="hq_admin">HQ admin</option>
        </select>
      </div>
      {role === "store_manager" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-store`}>Store</Label>
          <select id={`${idPrefix}-store`} name="store_id" className={SELECT_CLASS} defaultValue={defaultStoreId ?? stores[0]?.store_id}>
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.name} ({store.code})
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function useCloseOnSuccess(success: boolean, onDone: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (success) {
      onDone();
      router.refresh();
    }
  }, [success, onDone, router]);
}

export function InviteStaffForm({ stores, onDone }: { stores: StoreOption[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(inviteStaff, INITIAL_ACTION_STATE);
  useCloseOnSuccess(state.success, onDone);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Invite staff</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-name">Full name</Label>
        <Input id="invite-name" name="full_name" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-email">Email (sign-in)</Label>
        <Input id="invite-email" name="email" type="email" required autoComplete="off" />
      </div>
      <RoleAndStore stores={stores} defaultRole="store_manager" defaultStoreId={null} idPrefix="invite" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-password">Temporary password (min 12 characters)</Label>
        <Input id="invite-password" name="password" type="password" minLength={12} required autoComplete="new-password" />
        <p className="text-body-sm font-body-sm text-on-surface-variant">Share it with the person securely.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-pin">Supervisor PIN (4-8 digits)</Label>
        <Input id="invite-pin" name="pin" inputMode="numeric" pattern="\d{4,8}" required autoComplete="off" />
      </div>
      {state.error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {state.error}
        </p>
      )}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create login"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function EditStaffForm({ user, stores, isSelf, onDone }: { user: UserRow; stores: StoreOption[]; isSelf: boolean; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateStaff, INITIAL_ACTION_STATE);
  useCloseOnSuccess(state.success, onDone);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>Edit {user.full_name}</SheetTitle>
      </SheetHeader>
      <input type="hidden" name="user_id" value={user.user_id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="staff-name">Full name</Label>
        <Input id="staff-name" name="full_name" defaultValue={user.full_name} required />
      </div>
      {isSelf ? (
        <>
          <input type="hidden" name="role" value="hq_admin" />
          <p className="text-body-md font-body-md text-on-surface-variant">You can&apos;t change your own role.</p>
        </>
      ) : (
        <RoleAndStore stores={stores} defaultRole={user.role} defaultStoreId={user.store_id} idPrefix="staff" />
      )}
      {state.error !== null && (
        <p role="alert" className="text-body-md font-body-md text-destructive">
          {state.error}
        </p>
      )}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </SheetFooter>
    </form>
  );
}
