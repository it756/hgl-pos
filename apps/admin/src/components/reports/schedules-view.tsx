"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { deleteSchedule, queueScheduleRun, saveSchedule, setScheduleActive } from "../../app/(app)/reports/schedules/actions";
import { SCHEDULED_REPORTS, nextDueAt, type ReportScheduleRow } from "../../lib/reports/schedules";
import type { StoreOption } from "../../lib/catalog/options";
import { INITIAL_ACTION_STATE, SELECT_CLASS, formatDateTime } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const REPORT_LABEL = new Map<string, string>(SCHEDULED_REPORTS.map((report) => [report.value, report.label]));

type Props = { schedules: ReportScheduleRow[]; stores: StoreOption[]; isHq: boolean };

export function SchedulesView({ schedules, stores, isHq }: Props) {
  const router = useRouter();
  const storeName = new Map(stores.map((store) => [store.store_id, store.name]));
  const [editing, setEditing] = useState<ReportScheduleRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-md">
      <Link href="/reports" className="text-body-md text-primary hover:underline">
        ← Reports
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Scheduled reports</h1>
          <p className="text-body-md font-body-md text-on-surface-variant">
            Schedules run from an hourly job and cover the default reporting window. &quot;Run at next cycle&quot; queues a schedule for the
            next hourly run — it does not run instantly.
          </p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" />
          New schedule
        </Button>
      </div>
      {error !== null && <p role="alert" className="text-body-md text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Report</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Recipient</TableHead>
            <TableHead>Cadence</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead>Next due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => {
            const due = nextDueAt(schedule);
            return (
              <TableRow key={schedule.schedule_id}>
                <TableCell className="font-medium text-on-surface">
                  {REPORT_LABEL.get(schedule.report) ?? schedule.report} <span className="uppercase text-on-surface-variant">({schedule.format})</span>
                </TableCell>
                <TableCell>{schedule.store_id === null ? "All stores" : (storeName.get(schedule.store_id) ?? schedule.store_id)}</TableCell>
                <TableCell>{schedule.recipient_email}</TableCell>
                <TableCell className="capitalize">{schedule.cadence}</TableCell>
                <TableCell>{formatDateTime(schedule.last_run_at)}</TableCell>
                <TableCell>{due === null ? "—" : due === "next_run" ? "Next hourly run" : formatDateTime(due.toISOString())}</TableCell>
                <TableCell>
                  <Badge variant={schedule.is_active ? "success" : "outline"}>{schedule.is_active ? "Active" : "Paused"}</Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(schedule)}>
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => queueScheduleRun(schedule.schedule_id))}>
                    Run at next cycle
                  </Button>
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setScheduleActive(schedule.schedule_id, !schedule.is_active))}>
                    {schedule.is_active ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Delete this schedule?")) run(() => deleteSchedule(schedule.schedule_id));
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {schedules.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-on-surface-variant">
                No scheduled reports.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent>
          {editing !== null && (
            <ScheduleForm
              key={editing === "new" ? "new" : editing.schedule_id}
              schedule={editing === "new" ? null : editing}
              stores={stores}
              isHq={isHq}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ScheduleForm({ schedule, stores, isHq, onDone }: { schedule: ReportScheduleRow | null; stores: StoreOption[]; isHq: boolean; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveSchedule, INITIAL_ACTION_STATE);
  useEffect(() => {
    if (state.success) {
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction} className="flex h-full flex-col gap-md">
      <SheetHeader>
        <SheetTitle>{schedule === null ? "New schedule" : "Edit schedule"}</SheetTitle>
      </SheetHeader>
      {schedule !== null && <input type="hidden" name="schedule_id" value={schedule.schedule_id} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-report">Report</Label>
        <select id="schedule-report" name="report" className={SELECT_CLASS} defaultValue={schedule?.report ?? "sales_by_store"}>
          {SCHEDULED_REPORTS.map((report) => (
            <option key={report.value} value={report.value}>
              {report.label}
            </option>
          ))}
        </select>
      </div>
      {isHq && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-store">Scope</Label>
          <select id="schedule-store" name="store_id" className={SELECT_CLASS} defaultValue={schedule?.store_id ?? ""}>
            <option value="">All stores (consolidated)</option>
            {stores.map((store) => (
              <option key={store.store_id} value={store.store_id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-format">Format</Label>
        <select id="schedule-format" name="format" className={SELECT_CLASS} defaultValue={schedule?.format ?? "csv"}>
          <option value="csv">CSV</option>
          <option value="pdf">PDF</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-cadence">Cadence</Label>
        <select id="schedule-cadence" name="cadence" className={SELECT_CLASS} defaultValue={schedule?.cadence ?? "daily"}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="schedule-email">Recipient email</Label>
        <Input id="schedule-email" name="recipient_email" type="email" defaultValue={schedule?.recipient_email} required />
      </div>
      {state.error !== null && <p role="alert" className="text-body-md text-destructive">{state.error}</p>}
      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </SheetFooter>
    </form>
  );
}