import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listCounts } from "../../../lib/counts/service";
import { loadStoreOptions } from "../../../lib/catalog/options";
import { loadCategories } from "../../../lib/catalog/service";
import { CountsList } from "../../../components/counts/counts-list";

export default async function CountsPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const [counts, stores, categories] = await Promise.all([listCounts(supabase), loadStoreOptions(supabase), loadCategories(supabase)]);

  return (
    <main className="p-md">
      <CountsList
        counts={counts}
        stores={stores}
        categories={categories.filter((category) => category.is_active)}
        isHq={claims.role === "hq_admin"}
      />
    </main>
  );
}
