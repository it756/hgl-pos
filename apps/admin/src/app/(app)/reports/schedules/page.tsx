import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { listSchedules } from "../../../../lib/reports/schedules";
import { loadStoreOptions } from "../../../../lib/catalog/options";
import { SchedulesView } from "../../../../components/reports/schedules-view";

export default async function ReportSchedulesPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const [schedules, stores] = await Promise.all([listSchedules(supabase), loadStoreOptions(supabase)]);

  return (
    <main className="p-md">
      <SchedulesView schedules={schedules} stores={stores} isHq={claims.role === "hq_admin"} />
    </main>
  );
}