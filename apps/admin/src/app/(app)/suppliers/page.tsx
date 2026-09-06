import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listSuppliers, listSkuSupplierLinks, loadSupplierCatalog } from "../../../lib/suppliers/service";
import { SuppliersDashboard } from "../../../components/suppliers-dashboard";

export default async function SuppliersPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [suppliers, links, catalog] = await Promise.all([
    listSuppliers(supabase),
    listSkuSupplierLinks(supabase),
    loadSupplierCatalog(supabase),
  ]);

  return (
    <main className="p-md">
      <SuppliersDashboard suppliers={suppliers} links={links} skus={catalog.skus} canManage={claims.role === "hq_admin"} />
    </main>
  );
}
