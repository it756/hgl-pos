import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadSkuOptions, loadStoreOptions } from "../../../lib/catalog/options";
import { listPromotions } from "../../../lib/promotions/promotions";
import { listTiers } from "../../../lib/customers/service";
import { PromotionsView } from "../../../components/promotions/promotions-view";

export default async function PromotionsPage() {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();

  const [skus, stores, promotions, tiers] = await Promise.all([
    loadSkuOptions(supabase),
    loadStoreOptions(supabase),
    listPromotions(supabase),
    listTiers(supabase),
  ]);

  return (
    <main className="p-md">
      <PromotionsView skus={skus} stores={stores} promotions={promotions}
        loyaltyTiers={tiers.filter((tier) => tier.is_active).map((tier) => ({ code: tier.code, name: tier.name }))}
      />
    </main>
  );
}
