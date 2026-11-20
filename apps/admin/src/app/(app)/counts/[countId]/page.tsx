import { notFound } from "next/navigation";
import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { loadCount } from "../../../../lib/counts/service";
import { loadStoreOptions } from "../../../../lib/catalog/options";
import { CountSheet } from "../../../../components/counts/count-sheet";

export default async function CountDetailPage({ params }: { params: Promise<{ countId: string }> }) {
  await requireRole(["hq_admin", "store_manager"]);
  const { countId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(countId)) notFound();

  const supabase = await createSupabaseServerClient();
  const [count, stores] = await Promise.all([loadCount(supabase, countId), loadStoreOptions(supabase)]);
  if (count === null) notFound();

  return (
    <main className="p-md">
      <CountSheet count={count} storeName={stores.find((store) => store.store_id === count.store_id)?.name ?? "Store"} />
    </main>
  );
}
