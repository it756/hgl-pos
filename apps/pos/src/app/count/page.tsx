"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../lib/auth/cashier-session";
import { searchSkusByName, type SkuRow } from "../../lib/pricing/lookup";
import { createCountCorrectionQueue, getTillId } from "../../lib/till/services";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

export default function CountPage() {
  const db = useDb();
  const router = useRouter();

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<SkuRow[]>([]);
  const [selectedSku, setSelectedSku] = useState<SkuRow | null>(null);
  const [ledgerQty, setLedgerQty] = useState<number | null>(null);
  const [countedQty, setCountedQty] = useState("");
  const [reasonCode, setReasonCode] = useState("cycle_count");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const sessionManager = new CashierSessionManager({ db });
      const current = await sessionManager.getCurrentSession();
      if (cancelled) return;
      if (current === null) {
        router.replace("/login");
        return;
      }
      setSession(current);
      setTillId(await getTillId(db));
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  useEffect(() => {
    let cancelled = false;
    if (searchTerm.trim().length < 2) {
      setResults([]);
      return;
    }

    async function search() {
      const rows = await searchSkusByName(db, searchTerm.trim());
      if (!cancelled) setResults(rows);
    }

    void search();
    return () => {
      cancelled = true;
    };
  }, [db, searchTerm]);

  async function handleSelectSku(sku: SkuRow) {
    setSelectedSku(sku);
    setResults([]);
    setSearchTerm(sku.name);
    setError(null);

    if (tillId === null || session === null || session.store_id === null) return;
    const queue = createCountCorrectionQueue(db, tillId, session.store_id);
    setLedgerQty(await queue.getLedgerQty(sku.sku_id));
  }

  const parsedCountedQty = Number(countedQty);
  const validCountedQty = countedQty.length > 0 && Number.isFinite(parsedCountedQty);
  const deltaPreview = ledgerQty !== null && validCountedQty ? parsedCountedQty - ledgerQty : null;

  async function handleSubmit() {
    if (selectedSku === null || tillId === null || session === null || session.store_id === null) return;
    if (!validCountedQty) {
      setError("Enter the counted quantity.");
      return;
    }
    if (reasonCode.trim().length === 0) {
      setError("A reason is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const queue = createCountCorrectionQueue(db, tillId, session.store_id);
      await queue.recordCount({
        skuId: selectedSku.sku_id,
        countedQty: parsedCountedQty,
        reasonCode: reasonCode.trim(),
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });

      setSuccessMessage(`Count recorded for ${selectedSku.name}.`);
      setSelectedSku(null);
      setSearchTerm("");
      setCountedQty("");
      setNotes("");
      setLedgerQty(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (session === null) return null;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center p-md">
      <Card>
        <CardHeader>
          <CardTitle>Stock count</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">Search SKU by name</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSelectedSku(null);
                setLedgerQty(null);
              }}
              className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
              placeholder="e.g. maize meal"
            />
          </label>

          {results.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-outline-variant">
              {results.map((sku) => (
                <li key={sku.sku_id}>
                  <button
                    type="button"
                    className="w-full px-md py-2 text-left text-body-md font-body-md text-on-surface hover:bg-surface-container-low"
                    onClick={() => void handleSelectSku(sku)}
                  >
                    {sku.name} <span className="text-on-surface-variant">({sku.code})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedSku !== null && (
            <>
              <dl className="grid grid-cols-2 gap-y-1 text-body-md font-body-md">
                <dt className="text-on-surface-variant">Current ledger qty</dt>
                <dd className="text-right text-on-surface">{ledgerQty ?? "…"}</dd>
              </dl>

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Counted quantity</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  value={countedQty}
                  onChange={(event) => setCountedQty(event.target.value)}
                  className="h-12 rounded-lg border border-outline-variant bg-surface px-md text-headline-md font-headline-md text-on-surface"
                />
              </label>

              {deltaPreview !== null && (
                <p className="text-body-md font-body-md text-on-surface-variant">
                  Delta: {deltaPreview > 0 ? "+" : ""}
                  {deltaPreview}
                </p>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Reason</span>
                <input
                  type="text"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="min-h-16 rounded-lg border border-outline-variant bg-surface px-md py-2 text-body-md font-body-md text-on-surface"
                />
              </label>

              {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}
              {successMessage !== null && <p className="text-body-md font-body-md text-on-surface">{successMessage}</p>}

              <Button type="button" size="lg" disabled={submitting} onClick={() => void handleSubmit()}>
                {submitting ? "Recording…" : "Record count"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
