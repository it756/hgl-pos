import Link from "next/link";
import type { Route } from "next";
import type { LookupLists } from "../../lib/sales/filters";
import { PAGE_SIZE, toQueryString } from "../../lib/sales/filters";
import { SELECT_CLASS } from "../../lib/format";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Values = {
  from: string;
  to: string;
  storeId: string | null;
  tillId: string | null;
  cashierId: string | null;
  status: string | null;
};

type Props = {
  action: string;
  values: Values;
  lists: LookupLists;
  showStore: boolean;
  statuses: { value: string; label: string }[];
  extra?: React.ReactNode;
};

export function FilterBar({ action, values, lists, showStore, statuses, extra }: Props) {
  const tills = values.storeId === null ? lists.tills : lists.tills.filter((till) => till.store_id === values.storeId);
  const cashiers = values.storeId === null ? lists.cashiers : lists.cashiers.filter((cashier) => cashier.store_id === values.storeId);

  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-sm rounded-xl border border-surface-container-high bg-surface-container-lowest p-sm">
      <Field label="From" htmlFor="filter-from">
        <Input id="filter-from" name="from" type="date" defaultValue={values.from} />
      </Field>
      <Field label="To" htmlFor="filter-to">
        <Input id="filter-to" name="to" type="date" defaultValue={values.to} />
      </Field>
      {showStore && (
        <Field label="Store" htmlFor="filter-store">
          <select id="filter-store" name="store_id" className={SELECT_CLASS} defaultValue={values.storeId ?? ""}>
            <option value="">All stores</option>
            {lists.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Till" htmlFor="filter-till">
        <select id="filter-till" name="till_id" className={SELECT_CLASS} defaultValue={values.tillId ?? ""}>
          <option value="">All tills</option>
          {tills.map((till) => (
            <option key={till.id} value={till.id}>
              {till.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cashier" htmlFor="filter-cashier">
        <select id="filter-cashier" name="cashier_id" className={SELECT_CLASS} defaultValue={values.cashierId ?? ""}>
          <option value="">All cashiers</option>
          {cashiers.map((cashier) => (
            <option key={cashier.id} value={cashier.id}>
              {cashier.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" htmlFor="filter-status">
        <select id="filter-status" name="status" className={SELECT_CLASS} defaultValue={values.status ?? ""}>
          <option value="">Any</option>
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </Field>
      {extra}
      <Button type="submit">Apply</Button>
      <Link href={action as Route} className="pb-2 text-body-md text-primary hover:underline">
        Reset
      </Link>
    </form>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function Pagination({ path, query, page, total }: { path: string; query: Record<string, string | number | boolean | null>; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (target: number) => `${path}${toQueryString({ ...query, page: target === 1 ? null : target })}` as Route;
  return (
    <div className="flex items-center justify-between text-body-md text-on-surface-variant">
      <span>
        {total === 0 ? "No results" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
      </span>
      <span className="flex gap-sm">
        {page > 1 && (
          <Link href={link(page - 1)} className="text-primary hover:underline">
            ← Previous
          </Link>
        )}
        <span>
          Page {Math.min(page, pages)} of {pages}
        </span>
        {page < pages && (
          <Link href={link(page + 1)} className="text-primary hover:underline">
            Next →
          </Link>
        )}
      </span>
    </div>
  );
}
