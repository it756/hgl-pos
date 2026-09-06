"use client";

import { useActionState, useMemo } from "react";
import { saveRolloutRecord, type RolloutRecordFormState } from "../app/(app)/rollout/actions";
import type { RolloutRecord } from "../lib/rollout/service";
import type { StoreOption } from "../lib/catalog/options";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export type RolloutDashboardProps = {
  records: RolloutRecord[];
  stores: StoreOption[];
  canWrite: boolean;
};

const initialState: RolloutRecordFormState = { error: null, success: false };

export function RolloutDashboard({ records, stores, canWrite }: RolloutDashboardProps) {
  const [state, formAction, pending] = useActionState(saveRolloutRecord, initialState);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [records],
  );

  return (
    <div className="grid grid-cols-1 gap-md xl:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Rollout records</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>App version</TableHead>
                <TableHead>Pilot soak</TableHead>
                <TableHead>Offline drill</TableHead>
                <TableHead>Schema compat</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRecords.map((record) => (
                <TableRow key={record.rollout_record_id}>
                  <TableCell>
                    {record.store_code} — {record.store_name}
                  </TableCell>
                  <TableCell>{record.app_version}</TableCell>
                  <TableCell>
                    <ResultBadge result={record.pilot_soak_result} />
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={record.offline_drill_result} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={record.schema_compat_verified ? "default" : "outline"}>
                      {record.schema_compat_verified ? "Verified" : "Not verified"}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(record.updated_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {sortedRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-on-surface-variant">
                    No rollout records yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Record rollout stage</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="flex flex-col gap-md">
              <div className="flex flex-col gap-1">
                <Label htmlFor="store_id">Store</Label>
                <select
                  id="store_id"
                  name="store_id"
                  required
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
                >
                  {stores.map((store) => (
                    <option key={store.store_id} value={store.store_id}>
                      {store.code} — {store.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="app_version">App version</Label>
                <Input id="app_version" name="app_version" type="text" placeholder="1.4.0" required />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="pilot_soak_result">Pilot soak result</Label>
                <select
                  id="pilot_soak_result"
                  name="pilot_soak_result"
                  defaultValue="pending"
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
                >
                  <option value="pending">Pending</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="offline_drill_result">Offline drill result</Label>
                <select
                  id="offline_drill_result"
                  name="offline_drill_result"
                  defaultValue="pending"
                  className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md"
                >
                  <option value="pending">Pending</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input id="schema_compat_verified" name="schema_compat_verified" type="checkbox" className="h-4 w-4" />
                <Label htmlFor="schema_compat_verified">Schema-compat verification passed</Label>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" name="notes" type="text" placeholder="Optional context" />
              </div>

              {state.error !== null && (
                <p role="alert" className="text-body-md font-body-md text-destructive">
                  {state.error}
                </p>
              )}
              {state.success && <p className="text-body-md font-body-md text-green-700">Rollout record saved.</p>}

              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save record"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: "pending" | "pass" | "fail" }) {
  if (result === "pass") return <Badge variant="default">Pass</Badge>;
  if (result === "fail") return <Badge variant="destructive">Fail</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}
