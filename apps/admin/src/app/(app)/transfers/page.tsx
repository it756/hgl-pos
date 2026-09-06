import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listTransfers, loadTransferCatalog, loadTransferRequestLineItems } from "../../../lib/events/transfer";
import { TransfersDashboard } from "../../../components/transfers-dashboard";

export default async function TransfersPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [transfers, catalog] = await Promise.all([listTransfers(supabase), loadTransferCatalog(supabase)]);
  const requestedLineItemsByTransfer = await loadTransferRequestLineItems(
    supabase,
    transfers.map((transfer) => transfer.transfer_id),
  );

  return (
    <main className="p-md">
      <TransfersDashboard
        transfers={transfers}
        requestedLineItemsByTransfer={requestedLineItemsByTransfer}
        skus={catalog.skus}
        stores={catalog.stores}
        currentUserId={claims.userId}
        currentStoreId={claims.storeId}
        role={claims.role}
      />
    </main>
  );
}
