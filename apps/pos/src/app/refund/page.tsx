"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../lib/auth/cashier-session";
import { getSaleEventById } from "../../lib/events/sale";
import {
  RefundConnectivityError,
  signInForRefundVerification,
  verifyRefundEligibility,
  type VerifyRefundEligibleResponse,
} from "../../lib/events/refund";
import {
  createRefundEventQueue,
  createShiftEventQueue,
  createVoidEventQueue,
  getSupabaseAnonKey,
  getSupabaseUrl,
  getTillId,
  getVerifyRefundEndpoint,
} from "../../lib/till/services";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

type Mode = "lookup" | "same_session_void" | "connectivity_required";

const INELIGIBLE_REASON_LABEL: Record<string, string> = {
  already_refunded: "This sale has already been voided or refunded.",
  sale_not_found: "No matching sale was found for this store.",
  outside_refund_window: "This sale is outside the allowed refund window.",
};

export default function RefundPage() {
  const db = useDb();
  const router = useRouter();

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);

  const [saleIdInput, setSaleIdInput] = useState("");
  const [mode, setMode] = useState<Mode>("lookup");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [refundReason, setRefundReason] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifyRefundEligibleResponse | null>(null);

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

      const till = await getTillId(db);
      if (cancelled) return;
      setTillId(till);

      if (till !== null && current.store_id !== null) {
        const shiftQueue = createShiftEventQueue(db, till, current.store_id);
        const openShift = await shiftQueue.getOpenShift();
        if (!cancelled) setCurrentShiftId(openShift?.shift_id ?? null);
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  const resetVerification = useCallback(() => {
    setVerified(null);
    setVerifyError(null);
    setSuccessMessage(null);
    setError(null);
  }, []);

  async function handleLookup() {
    setLookupError(null);
    resetVerification();
    const saleId = saleIdInput.trim();
    if (saleId.length === 0) {
      setLookupError("Enter the original sale ID (from the receipt).");
      return;
    }

    const local = await getSaleEventById(db, saleId);
    const sameSession =
      local !== null && local.status === "completed" && local.till_id === tillId && local.shift_id === currentShiftId;

    setMode(sameSession ? "same_session_void" : "connectivity_required");
  }

  async function handleVoidSameSession() {
    if (session === null || session.store_id === null || tillId === null || currentShiftId === null) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const queue = createVoidEventQueue(db, tillId, session.store_id);
      await queue.voidSale({ saleId: saleIdInput.trim(), cashierId: session.user_id, shiftId: currentShiftId });
      setSuccessMessage("Sale voided.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOnline() {
    setVerifyError(null);
    setVerified(null);
    if (refundReason.trim().length === 0) {
      setVerifyError("A refund reason is required.");
      return;
    }
    if (email.trim().length === 0 || password.length === 0) {
      setVerifyError("Enter your Supabase sign-in email and password to verify this refund online.");
      return;
    }

    setVerifying(true);
    try {
      const accessToken = await signInForRefundVerification({
        supabaseUrl: getSupabaseUrl(),
        supabaseAnonKey: getSupabaseAnonKey(),
        email: email.trim(),
        password,
      });

      const response = await verifyRefundEligibility({
        endpoint: getVerifyRefundEndpoint(),
        accessToken,
        originalSaleId: saleIdInput.trim(),
        refundReason: refundReason.trim(),
      });

      if (!response.eligible) {
        setVerifyError(INELIGIBLE_REASON_LABEL[response.reason] ?? response.reason);
        return;
      }

      setVerified(response);
    } catch (err) {
      // FR-012: any connectivity failure at this step must be an explicit,
      // unambiguous refusal — never a silent fall-back to a local write.
      setVerifyError(
        err instanceof RefundConnectivityError
          ? `Connectivity required: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleConfirmRefund() {
    if (session === null || session.store_id === null || tillId === null || currentShiftId === null || verified === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const queue = createRefundEventQueue(db, tillId, session.store_id);
      await queue.refundSale({
        cashierId: session.user_id,
        shiftId: currentShiftId,
        refundReason: refundReason.trim(),
        refundToken: verified.refund_token,
        original: verified.original,
      });
      setSuccessMessage("Refund issued.");
      setVerified(null);
      setSaleIdInput("");
      setMode("lookup");
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
          <CardTitle>Refund a sale</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          {currentShiftId === null && (
            <p className="text-body-md font-body-md text-destructive">
              No shift is open on this till — open a shift before issuing a refund.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">Original sale ID (from receipt)</span>
            <input
              type="text"
              value={saleIdInput}
              onChange={(event) => {
                setSaleIdInput(event.target.value);
                setMode("lookup");
                resetVerification();
              }}
              className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
              placeholder="e.g. 3f9a1c2e-..."
            />
          </label>

          {lookupError !== null && <p className="text-body-md font-body-md text-destructive">{lookupError}</p>}

          {mode === "lookup" && (
            <Button type="button" size="lg" disabled={currentShiftId === null} onClick={() => void handleLookup()}>
              Look up sale
            </Button>
          )}

          {mode === "same_session_void" && (
            <div className="flex flex-col gap-sm">
              <p className="text-body-md font-body-md text-on-surface-variant">
                This sale was made in your current shift on this till — it can be voided offline.
              </p>
              {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}
              {successMessage !== null && <p className="text-body-md font-body-md text-on-surface">{successMessage}</p>}
              <Button type="button" size="lg" disabled={submitting} onClick={() => void handleVoidSameSession()}>
                {submitting ? "Voiding…" : "Void this sale"}
              </Button>
            </div>
          )}

          {mode === "connectivity_required" && (
            <div className="flex flex-col gap-sm">
              <p className="text-body-md font-body-md text-on-surface-variant">
                This sale is from a different till or a previous shift — refunding it requires connectivity to
                confirm the original sale server-side (FR-012). No local write happens until that succeeds.
              </p>

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Refund reason</span>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                  placeholder="e.g. customer return, wrong item"
                />
              </label>

              {verified === null && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-label-md font-label-md text-on-surface-variant">Sign-in email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-label-md font-label-md text-on-surface-variant">Sign-in password</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-10 rounded-lg border border-outline-variant bg-surface px-md text-body-md font-body-md text-on-surface"
                    />
                  </label>

                  {verifyError !== null && <p className="text-body-md font-body-md text-destructive">{verifyError}</p>}

                  <Button type="button" size="lg" disabled={verifying} onClick={() => void handleVerifyOnline()}>
                    {verifying ? "Verifying…" : "Verify online"}
                  </Button>
                </>
              )}

              {verified !== null && (
                <>
                  <dl className="grid grid-cols-2 gap-y-1 text-body-md font-body-md">
                    <dt className="text-on-surface-variant">Original total</dt>
                    <dd className="text-right text-on-surface">{verified.original.grand_total.toFixed(2)}</dd>
                    <dt className="text-on-surface-variant">Original till</dt>
                    <dd className="text-right text-on-surface">{verified.original.till_id}</dd>
                  </dl>

                  {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}
                  {successMessage !== null && (
                    <p className="text-body-md font-body-md text-on-surface">{successMessage}</p>
                  )}

                  <Button type="button" size="lg" disabled={submitting} onClick={() => void handleConfirmRefund()}>
                    {submitting ? "Refunding…" : "Confirm refund"}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
