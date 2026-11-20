import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listCustomers, listTiers } from "../../../lib/customers/service";
import { loadStoreOptions } from "../../../lib/catalog/options";
import type { SearchParams } from "../../../lib/sales/filters";
import { SELECT_CLASS } from "../../../lib/format";
import { TabNav } from "../../../components/tab-nav";
import { CustomersTable, TiersTable } from "../../../components/customers/customers-view";
import { Pagination } from "../../../components/sales/filter-bar";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";

function param(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const params = await searchParams;
  const tab = param(params, "tab") === "tiers" ? "tiers" : "customers";
  const search = param(params, "q");
  const statusParam = param(params, "status");
  const status = statusParam === "inactive" || statusParam === "all" ? statusParam : "active";
  const page = Math.max(1, Math.trunc(Number(param(params, "page")) || 1));

  const supabase = await createSupabaseServerClient();
  const [tiers, stores] = await Promise.all([listTiers(supabase), loadStoreOptions(supabase)]);

  let body: React.ReactNode;
  if (tab === "tiers") {
    const { data, error } = await supabase.from("customers").select("loyalty_tier_id").not("loyalty_tier_id", "is", null);
    if (error !== null) throw new Error(`Failed to count customers per tier: ${error.message}`);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { loyalty_tier_id: string }[]) counts[row.loyalty_tier_id] = (counts[row.loyalty_tier_id] ?? 0) + 1;
    body = <TiersTable tiers={tiers} canEdit={claims.role === "hq_admin"} customerCounts={counts} />;
  } else {
    const { rows, total } = await listCustomers(supabase, { search, status, page });
    body = (
      <>
        <form method="get" action="/customers" className="flex flex-wrap items-end gap-sm">
          <Input name="q" defaultValue={search} placeholder="Search name, phone or email" className="max-w-sm" aria-label="Search customers" />
          <select name="status" defaultValue={status} className={`${SELECT_CLASS} w-40`} aria-label="Status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <CustomersTable customers={rows} tiers={tiers} stores={stores} />
        <Pagination path="/customers" query={{ q: search, status: status === "active" ? null : status }} page={page} total={total} />
      </>
    );
  }

  return (
    <main className="flex flex-col gap-md p-md">
      <div>
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Customers</h1>
        <p className="text-body-md text-on-surface-variant">
          Customer, loyalty and credit records (FR-037). Customer lookup at the till isn&apos;t connected yet — these records are
          admin-only for now.
        </p>
      </div>
      <TabNav
        tabs={[
          { key: "customers", label: "Customers", href: "/customers" },
          { key: "tiers", label: "Loyalty tiers", href: "/customers?tab=tiers" },
        ]}
        active={tab}
      />
      {body}
    </main>
  );
}
