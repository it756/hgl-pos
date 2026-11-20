import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listStoreOptions, listUsers } from "../../../lib/users/service";
import { UsersDashboard } from "../../../components/users-dashboard";

export default async function UsersPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  // RLS (`users_read_store_scope`, 0009) already limits a store_manager's
  // rows to their own store — no extra filtering needed here.
  const [users, stores] = await Promise.all([
    listUsers(supabase),
    claims.role === "hq_admin" ? listStoreOptions(supabase) : Promise.resolve([]),
  ]);

  return (
    <main className="p-md">
      <UsersDashboard users={users} stores={stores} scope={claims.role === "hq_admin" ? "hq_admin" : "store_manager"}
        currentUserId={claims.userId}
      />
    </main>
  );
}
