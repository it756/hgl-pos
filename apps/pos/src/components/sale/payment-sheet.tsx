"use client";

import type { SaleEvent } from "@hgl/events";
import type { Tender } from "../../lib/tenders/types";
import { formatAmount, formatZmw } from "../../lib/format";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetContent } from "../ui/sheet";

export type TenderMethod = "cash" | "card" | "mobile_money_mtn" | "mobile_money_airtel";

const TENDER_METHODS: { method: TenderMethod; label: string }[] = [
  { method: "cash", label: "Cash" },
  { method: "card", label: "Card" },
  { method: "mobile_money_mtn", label: "MTN" },
  { method: "mobile_money_airtel", label: "Airtel" },
];

const QUICK_CASH = [50, 100, 200, 500];

const TENDER_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  mobile_money_mtn: "MTN mobile money",
  mobile_money_airtel: "Airtel mobile money",
};

export type PaymentSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  grandTotal: number;
  remaining: number;
  tenders: Tender[];
  tenderedTotal: number;
  tenderMethod: TenderMethod;
  onTenderMethodChange: (method: TenderMethod) => void;
  amountInput: string;
  onAmountInputChange: (value: string) => void;
  referenceInput: string;
  onReferenceInputChange: (value: string) => void;
  onAddTender: () => void;
  onCardTender: () => void;
  onClearTenders: () => void;
  tenderError: string | null;
  lastChangeDue: number | null;
  error: string | null;
  completing: boolean;
  canComplete: boolean;
  onComplete: () => void;

  completedSale: SaleEvent | null;
  nameFor: (skuId: string) => string;
  voiding: boolean;
  onDownloadReceipt: () => void;
  onVoidSale: () => void;
  onNewSale: () => void;
};

export function PaymentSheet(props: PaymentSheetProps) {
  const { open, onOpenChange, completedSale } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={completedSale === null ? "Payment" : `Sale ${completedSale.status === "completed" ? "complete" : "voided"}`}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {completedSale === null ? <PaymentBody {...props} /> : <ReceiptBody {...props} sale={completedSale} />}
      </SheetContent>
    </Sheet>
  );
}

function PaymentBody({
  grandTotal,
  remaining,
  tenders,
  tenderedTotal,
  tenderMethod,
  onTenderMethodChange,
  amountInput,
  onAmountInputChange,
  referenceInput,
  onReferenceInputChange,
  onAddTender,
  onCardTender,
  onClearTenders,
  tenderError,
  lastChangeDue,
  error,
  completing,
  canComplete,
  onComplete,
}: PaymentSheetProps) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 rounded-lg bg-surface-container-low px-3 py-2.5">
        <span className="text-body-md text-on-surface-variant">
          Total {formatZmw(grandTotal)}, tendered {formatAmount(tenderedTotal)}
        </span>
        <span className="whitespace-nowrap text-[26px] font-semibold leading-8 text-on-surface">
          {lastChangeDue !== null ? `Change ${formatAmount(lastChangeDue)}` : formatAmount(remaining)}
        </span>
      </div>
      <p className="text-body-md text-on-surface-variant">Remaining: {remaining.toFixed(2)} ZMW</p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tender method">
        {TENDER_METHODS.map(({ method, label }) => (
          <Button
            key={method}
            type="button"
            variant={tenderMethod === method ? "default" : "outline"}
            aria-pressed={tenderMethod === method}
            className="flex-1"
            onClick={() => onTenderMethodChange(method)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tenderMethod === "card" ? (
        <Button type="button" size="lg" onClick={onCardTender}>
          Tender with card
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            autoFocus
            value={amountInput}
            onChange={(event) => onAmountInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onAddTender();
            }}
            placeholder={`Amount (${remaining.toFixed(2)})`}
            aria-label="Amount"
            className="min-h-12 text-body-lg"
          />
          {tenderMethod === "cash" && (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onAmountInputChange(remaining.toFixed(2))}>
                Exact
              </Button>
              {QUICK_CASH.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => onAmountInputChange(String(value))}
                >
                  {value}
                </Button>
              ))}
            </div>
          )}
          {tenderMethod !== "cash" && (
            <Input
              value={referenceInput}
              onChange={(event) => onReferenceInputChange(event.target.value)}
              placeholder="Mobile money reference"
              className="min-h-12"
            />
          )}
          <Button type="button" variant="outline" size="lg" onClick={onAddTender}>
            Add tender
          </Button>
        </div>
      )}

      {tenderError !== null && <p className="text-body-md text-destructive">{tenderError}</p>}

      {tenders.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {tenders.map((tender, index) => (
            <li key={index} className="flex items-center justify-between gap-2 text-body-md text-on-surface">
              <span>
                {TENDER_LABELS[tender.type] ?? tender.type} {formatAmount(tender.amount)}
              </span>
              <Badge variant="success">Captured</Badge>
            </li>
          ))}
        </ul>
      )}
      {lastChangeDue !== null && (
        <p className="rounded-lg bg-success-container px-3 py-2.5 text-body-md text-success">
          Change due: {lastChangeDue.toFixed(2)} ZMW
        </p>
      )}

      {error !== null && <p className="text-body-md text-destructive">{error}</p>}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {tenders.length > 0 && (
          <Button type="button" variant="ghost" onClick={onClearTenders}>
            Clear tenders
          </Button>
        )}
        <Button type="button" size="xl" disabled={completing || !canComplete} onClick={onComplete}>
          {completing ? "Completing sale…" : `Complete sale — ${tenderedTotal.toFixed(2)} tendered`}
        </Button>
      </div>
    </>
  );
}

function ReceiptBody({
  sale,
  nameFor,
  lastChangeDue,
  error,
  voiding,
  onDownloadReceipt,
  onVoidSale,
  onNewSale,
}: PaymentSheetProps & { sale: SaleEvent }) {
  const completed = sale.status === "completed";
  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant={completed ? "success" : "destructive"}>{sale.status}</Badge>
        <span className="text-body-md text-on-surface-variant">{new Date(sale.client_ts).toTimeString().slice(0, 5)}</span>
      </div>
      <p className="break-all text-body-md text-on-surface-variant">Sale ID: {sale.sale_id}</p>

      <div className="flex flex-col gap-1 border-t border-dashed border-outline-variant pt-2 text-body-md">
        {sale.items.map((item, index) => (
          <div key={`${item.sku_id}-${index}`} className="flex justify-between gap-2">
            <span>
              {item.qty} x {nameFor(item.sku_id)}
            </span>
            <span>{formatAmount(item.line_total)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-dashed border-outline-variant pt-2 text-body-md">
        <div className="flex justify-between text-on-surface-variant">
          <span>Discounts</span>
          <span>-{formatAmount(sale.discount_total)}</span>
        </div>
        <div className="flex justify-between text-on-surface-variant">
          <span>Tax</span>
          <span>{formatAmount(sale.tax_total)}</span>
        </div>
        <div className="flex justify-between text-body-lg font-semibold">
          <span>Total</span>
          <span>{formatZmw(sale.grand_total)}</span>
        </div>
        {sale.tenders.map((tender, index) => (
          <div key={index} className="flex justify-between text-on-surface-variant">
            <span>{TENDER_LABELS[tender.type] ?? tender.type}</span>
            <span>{formatAmount(tender.amount)}</span>
          </div>
        ))}
        {lastChangeDue !== null && (
          <div className="flex justify-between text-on-surface-variant">
            <span>Change given</span>
            <span>{formatAmount(lastChangeDue)}</span>
          </div>
        )}
      </div>

      {error !== null && <p className="text-body-md text-destructive">{error}</p>}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button type="button" variant="outline" size="lg" onClick={onDownloadReceipt}>
          Download receipt (PDF)
        </Button>
        {completed && (
          <Button type="button" variant="outline" size="lg" className="text-destructive" disabled={voiding} onClick={onVoidSale}>
            {voiding ? "Voiding…" : "Void this sale"}
          </Button>
        )}
        <Button type="button" size="xl" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </>
  );
}
