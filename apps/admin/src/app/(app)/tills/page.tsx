import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listTills } from "../../../lib/tills/service";
import { loadStoreOptions } from "../../../lib/catalog/options";
import { TillsDashboard } from "../../../components/tills/tills-dashboard";

export default async function TillsPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  // RLS (`tills_read_store_scope`) limits store managers to their own store.
  const [tills, stores] = await Promise.all([listTills(supabase), loadStoreOptions(supabase)]);

  return (
    <main className="p-md">
      <TillsDashboard tills={tills} stores={stores} canManage={claims.role === "hq_admin"} />
    </main>
  );
}