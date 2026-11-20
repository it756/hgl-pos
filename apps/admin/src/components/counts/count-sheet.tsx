"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelCount, saveCountedQuantities, submitCount } from "../../app/(app)/counts/actions";
import { lineVariance, parseCountedValue, type CountDetail } from "../../lib/counts/service";
import { formatDateTime, formatQty } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const STATUS_VARIANT = { open: "warning", submitted: "success", cancelled: "outline" } as const;

export function CountSheet({ count, storeName }: { count: CountDetail; storeName: string }) {
  const router = useRouter();
  const isOpen = count.status === "open";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [uncountedOnly, setUncountedOnly] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const lines = useMemo(
    () =>
      count.lines.map((line) => {
        const draft = drafts[line.sku_id];
        const parsed = draft === undefined ? line.counted_qty : parseCountedValue(draft);
        return { ...line, draft, effective: parsed };
      }),
    [count.lines, drafts],
  );

  const term = search.trim().toLowerCase();
  const visible = lines.filter(
    (line) =>
      (!uncountedOnly || line.effective === null) &&
      (term === "" || line.code.toLowerCase().includes(term) || line.name.toLowerCase().includes(term)),
  );
  const dirty = Object.keys(drafts).length;
  const invalid = lines.some((line) => line.effective === "invalid");
  const countedTotal = lines.filter((line) => line.effective !== null && line.effective !== "invalid").length;

  function persist(): Promise<boolean> {
    return new Promise((resolve) => {
      if (dirty === 0) return resolve(true);
      if (invalid) {
        setMessage({ tone: "error", text: "Fix invalid quantities first (must be zero or more)." });
        return resolve(false);
      }
      const entries = lines
        .filter((line) => line.draft !== undefined)
        .map((line) => ({ sku_id: line.sku_id, counted_qty: line.effective as number | null }));
      startTransition(async () => {
        const result = await saveCountedQuantities(count.count_id, entries);
        if (result.error !== null) {
          setMessage({ tone: "error", text: result.error });
          resolve(false);
          return;
        }
        setDrafts({});
        setMessage({ tone: "info", text: `Saved ${entries.length} line(s).` });
        router.refresh();
        resolve(true);
      });
    });
  }

  async function handleSubmit() {
    const uncounted = lines.length - countedTotal;
    const ok = window.confirm(
      `Submit this count? ${uncounted > 0 ? `${uncounted} uncounted line(s) will be left unchanged. ` : ""}` +
        "Corrections are posted against current stock and cannot be undone.",
    );
    if (!ok || !(await persist())) return;
    startTransition(async () => {
      const result = await submitCount(count.count_id);
      setMessage(result.error !== null ? { tone: "error", text: result.error } : { tone: "info", text: `Submitted — ${result.corrections ?? 0} correction(s) posted.` });
      router.refresh();
    });
  }

  function handleCancel() {
    if (!window.confirm("Cancel this count? Nothing will be posted to stock.")) return;
    startTransition(async () => {
      const result = await cancelCount(count.count_id);
      setMessage(result.error !== null ? { tone: "error", text: result.error } : null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-md">
      <Link href="/counts" className="text-body-md text-primary hover:underline">
        ← All stock counts
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h1 className="flex items-center gap-2 text-headline-lg font-headline-lg font-semibold text-on-surface">
            Stock count · {storeName}
            <Badge variant={STATUS_VARIANT[count.status]}>{count.status}</Badge>
          </h1>
          <p className="text-body-md font-body-md text-on-surface-variant">
            Started {formatDateTime(count.created_at)} by {count.created_by_name ?? "—"}
            {count.closed_at !== null && ` · closed ${formatDateTime(count.closed_at)}`}
            {count.notes !== null && ` · ${count.notes}`}
          </p>
        </div>
        {isOpen && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy || dirty === 0} onClick={() => void persist()}>
              Save progress{dirty > 0 ? ` (${dirty})` : ""}
            </Button>
            <Button type="button" disabled={busy || invalid} onClick={() => void handleSubmit()}>
              Submit count
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={handleCancel}>
              Cancel count
            </Button>
          </div>
        )}
      </div>

      {message !== null && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-body-md text-destructive" : "text-body-md text-on-surface-variant"}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-sm">
        <Input aria-label="Search SKUs" placeholder="Search code or name" className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="flex items-center gap-2 text-body-md font-body-md text-on-surface">
          <input type="checkbox" checked={uncountedOnly} onChange={(event) => setUncountedOnly(event.target.checked)} />
          Uncounted only
        </label>
        <span className="text-body-md text-on-surface-variant">
          {countedTotal} / {lines.length} counted
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Expected (snapshot)</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            {!isOpen && <TableHead className="text-right">Correction posted</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((line) => {
            const variance = line.effective === "invalid" ? null : lineVariance({ expected_qty: line.expected_qty, counted_qty: line.effective });
            return (
              <TableRow key={line.sku_id}>
                <TableCell>
                  <span className="font-medium text-on-surface">{line.code}</span> · {line.name}
                </TableCell>
                <TableCell className="text-right">{formatQty(line.expected_qty)}</TableCell>
                <TableCell className="text-right">
                  {isOpen ? (
                    <Input
                      aria-label={`Counted quantity for ${line.code}`}
                      inputMode="decimal"
                      className={`ml-auto w-28 text-right ${line.effective === "invalid" ? "border-destructive" : ""}`}
                      value={line.draft ?? (line.counted_qty === null ? "" : String(line.counted_qty))}
                      onChange={(event) => setDrafts((current) => ({ ...current, [line.sku_id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[aria-label^='Counted quantity']"));
                          inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
                        }
                      }}
                    />
                  ) : (
                    formatQty(line.counted_qty)
                  )}
                </TableCell>
                <TableCell className={`text-right ${variance !== null && variance !== 0 ? (variance < 0 ? "text-destructive" : "text-amber-700") : ""}`}>
                  {variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatQty(variance)}`}
                </TableCell>
                {!isOpen && <TableCell className="text-right">{formatQty(line.correction_qty)}</TableCell>}
              </TableRow>
            );
          })}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={isOpen ? 4 : 5} className="text-center text-on-surface-variant">
                No lines match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
