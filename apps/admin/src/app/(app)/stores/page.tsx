import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listStores } from "../../../lib/stores/service";
import { StoresDashboard } from "../../../components/stores/stores-dashboard";

export default async function StoresPage() {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const stores = await listStores(supabase);

  return (
    <main className="p-md">
      <StoresDashboard stores={stores} />
    </main>
  );
}