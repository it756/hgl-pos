"use client";

import { useActionState } from "react";
import { updateSettings } from "../../app/(app)/settings/actions";
import { INITIAL_ACTION_STATE, TEXTAREA_CLASS, formatDateTime } from "../../lib/format";
import type { SettingRow, SystemSettings } from "../../lib/settings/schema";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Props = { settings: SystemSettings; rows: SettingRow[] };

export function SettingsForm({ settings, rows }: Props) {
  const [state, formAction, pending] = useActionState(updateSettings, INITIAL_ACTION_STATE);
  const rowByKey = new Map(rows.map((row) => [row.key, row]));

  function hint(key: keyof SystemSettings) {
    const row = rowByKey.get(key);
    return (
      <p className="text-body-sm font-body-sm text-on-surface-variant">
        {row?.description ?? ""} {row !== undefined && `Last updated ${formatDateTime(row.updated_at)}.`}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-md">
      <div className="grid gap-md md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="adjustment_approval_threshold_qty">Adjustment approval threshold (qty)</Label>
          <Input id="adjustment_approval_threshold_qty" name="adjustment_approval_threshold_qty" type="number" min={0} step="0.001" defaultValue={settings.adjustment_approval_threshold_qty} />
          {hint("adjustment_approval_threshold_qty")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expiry_warning_days">Expiry warning window (days)</Label>
          <Input id="expiry_warning_days" name="expiry_warning_days" type="number" min={1} max={365} step={1} defaultValue={settings.expiry_warning_days} />
          {hint("expiry_warning_days")}
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="low_stock_alert_emails">Low-stock alert recipients</Label>
          <textarea id="low_stock_alert_emails" name="low_stock_alert_emails" className={TEXTAREA_CLASS} defaultValue={settings.low_stock_alert_emails.join("\n")} placeholder="one email per line" />
          {hint("low_stock_alert_emails")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receipt_header">Receipt header</Label>
          <Input id="receipt_header" name="receipt_header" maxLength={200} defaultValue={settings.receipt_header} />
          {hint("receipt_header")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receipt_footer">Receipt footer</Label>
          <Input id="receipt_footer" name="receipt_footer" maxLength={200} defaultValue={settings.receipt_footer} />
          {hint("receipt_footer")}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="default_report_timezone">Default report timezone</Label>
          <Input id="default_report_timezone" name="default_report_timezone" defaultValue={settings.default_report_timezone} />
          {hint("default_report_timezone")}
        </div>
      </div>

      {state.error !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{state.error}</p>}
      {state.success && <p role="status" className="text-body-md font-body-md text-on-surface-variant">{state.message}</p>}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}