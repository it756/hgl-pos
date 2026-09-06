"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../../lib/auth/cashier-session";
import { searchSkusByName, type SkuRow } from "../../../lib/pricing/lookup";
import { createAdjustmentRequestQueue, getTillId } from "../../../lib/till/services";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

export default function AdjustmentRequestPage() {
  const db = useDb();
  const router = useRouter();

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<SkuRow[]>([]);
  const [selectedSku, setSelectedSku] = useState<SkuRow | null>(null);
  const [deltaQty, setDeltaQty] = useState("");
  const [reasonCode, setReasonCode] = useState("");
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

  function handleSelectSku(sku: SkuRow) {
    setSelectedSku(sku);
    setResults([]);
    setSearchTerm(sku.name);
    setError(null);
  }

  const parsedDeltaQty = Number(deltaQty);
  const validDeltaQty = deltaQty.length > 0 && Number.isFinite(parsedDeltaQty) && parsedDeltaQty !== 0;

  async function handleSubmit() {
    if (selectedSku === null || tillId === null || session === null || session.store_id === null) return;
    if (!validDeltaQty) {
      setError("Enter a non-zero adjustment amount (negative for shrinkage/damage, positive for a found-stock correction).");
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
      const queue = createAdjustmentRequestQueue(db, tillId, session.store_id);
      await queue.requestAdjustment({
        skuId: selectedSku.sku_id,
        deltaQty: parsedDeltaQty,
        reasonCode: reasonCode.trim(),
        notes: notes.trim().length > 0 ? notes.trim() : null,
        requestedByUserId: session.user_id,
      });

      setSuccessMessage(`Adjustment request submitted for ${selectedSku.name} — awaiting manager approval.`);
      setSelectedSku(null);
      setSearchTerm("");
      setDeltaQty("");
      setReasonCode("");
      setNotes("");
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
          <CardTitle>Request stock adjustment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          <p className="text-body-md font-body-md text-on-surface-variant">
            Adjustments require manager approval before stock is affected (FR-017).
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">Search SKU by name</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSelectedSku(null);
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
                    onClick={() => handleSelectSku(sku)}
                  >
                    {sku.name} <span className="text-on-surface-variant">({sku.code})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedSku !== null && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">
                  Adjustment amount (negative for loss/damage)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  value={deltaQty}
                  onChange={(event) => setDeltaQty(event.target.value)}
                  className="h-12 rounded-lg border border-outline-variant bg-surface px-md text-headline-md font-headline-md text-on-surface"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Reason</span>
                <input
                  type="text"
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                  placeholder="e.g. damaged in storage"
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
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
