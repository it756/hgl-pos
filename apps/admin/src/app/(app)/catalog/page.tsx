import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadAvailability, loadCategories, loadSkus } from "../../../lib/catalog/service";
import { loadStoreOptions } from "../../../lib/catalog/options";
import { TabNav, type TabItem } from "../../../components/tab-nav";
import { SkusTab } from "../../../components/catalog/skus-tab";
import { CategoriesTab } from "../../../components/catalog/categories-tab";
import { AvailabilityTab } from "../../../components/catalog/availability-tab";
import { ImportTab } from "../../../components/catalog/import-tab";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const isHq = claims.role === "hq_admin";
  const params = await searchParams;

  const tabs: TabItem[] = [
    { key: "skus", label: "Products", href: "/catalog?tab=skus" },
    { key: "categories", label: "Categories", href: "/catalog?tab=categories" },
    { key: "availability", label: "Store range & reorder levels", href: "/catalog?tab=availability" },
    ...(isHq ? [{ key: "import", label: "CSV import", href: "/catalog?tab=import" }] : []),
  ];
  const requested = typeof params.tab === "string" ? params.tab : "skus";
  const tab = tabs.some((item) => item.key === requested) ? requested : "skus";

  const supabase = await createSupabaseServerClient();
  const [skus, categories] = await Promise.all([loadSkus(supabase), loadCategories(supabase)]);

  let body: React.ReactNode;
  if (tab === "categories") {
    const skuCounts: Record<string, number> = {};
    for (const sku of skus) if (sku.category_id !== null) skuCounts[sku.category_id] = (skuCounts[sku.category_id] ?? 0) + 1;
    body = <CategoriesTab categories={categories} skuCounts={skuCounts} canEdit={isHq} />;
  } else if (tab === "availability") {
    const stores = await loadStoreOptions(supabase);
    const requestedStore = typeof params.store === "string" ? params.store : null;
    const storeId = isHq ? (stores.some((store) => store.store_id === requestedStore) ? requestedStore : (stores[0]?.store_id ?? null)) : claims.storeId;
    const availability = storeId === null ? [] : await loadAvailability(supabase, storeId);
    body = <AvailabilityTab skus={skus} stores={stores} storeId={storeId} availability={availability} isHq={isHq} />;
  } else if (tab === "import") {
    body = <ImportTab />;
  } else {
    body = <SkusTab skus={skus} categories={categories} canEdit={isHq} />;
  }

  return (
    <main className="flex flex-col gap-md p-md">
      <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Products</h1>
      <TabNav tabs={tabs} active={tab} />
      {body}
    </main>
  );
}
