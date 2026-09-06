export const DEFAULT_PERIPHERAL_TIMEOUT_MS = 5_000;
export const DEFAULT_PERIPHERAL_RETRY_ATTEMPTS = 2;
export const DEFAULT_PERIPHERAL_RETRY_DELAY_MS = 250;

export type PeripheralDeviceType = "receipt_printer" | "barcode_scanner" | "cash_drawer" | "msr" | "customer_display";

export type PeripheralStatus = {
  connected: boolean;
  ready: boolean;
  message?: string;
};

export type PeripheralOperationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type PeripheralRetryPolicy = {
  attempts: number;
  delayMs: number;
};

export type PeripheralAdapter<TDeviceType extends PeripheralDeviceType = PeripheralDeviceType> = {
  readonly deviceType: TDeviceType;
  getStatus(options?: PeripheralOperationOptions): Promise<PeripheralStatus>;
  close(): Promise<void>;
};

export type ReceiptLine = {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  width?: "normal" | "wide";
};

export type ReceiptPrintJob = {
  receiptId: string;
  lines: readonly ReceiptLine[];
  cutPaper?: boolean;
  openDrawer?: boolean;
};

export type ReceiptPrinterAdapter = PeripheralAdapter<"receipt_printer"> & {
  printReceipt(job: ReceiptPrintJob, options?: PeripheralOperationOptions): Promise<void>;
};

export type BarcodeScan = {
  value: string;
  symbology?: string;
  scannedAt: string;
};

export type BarcodeScannerAdapter = PeripheralAdapter<"barcode_scanner"> & {
  enable(options?: PeripheralOperationOptions): Promise<void>;
  disable(options?: PeripheralOperationOptions): Promise<void>;
  onScan(handler: (scan: BarcodeScan) => void): () => void;
};

export type CashDrawerStatus = PeripheralStatus & {
  open: boolean | null;
};

export type CashDrawerAdapter = PeripheralAdapter<"cash_drawer"> & {
  openDrawer(options?: PeripheralOperationOptions): Promise<void>;
  getDrawerStatus(options?: PeripheralOperationOptions): Promise<CashDrawerStatus>;
};

export type MsrTrackData = {
  maskedPan?: string;
  cardholderName?: string;
  serviceCode?: string;
  expiresAt?: string;
};

export type MsrSwipe = {
  swipeId: string;
  readAt: string;
  trackData: MsrTrackData;
};

export type MsrAdapter = PeripheralAdapter<"msr"> & {
  enable(options?: PeripheralOperationOptions): Promise<void>;
  disable(options?: PeripheralOperationOptions): Promise<void>;
  onSwipe(handler: (swipe: MsrSwipe) => void): () => void;
};

export async function runPeripheralOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: PeripheralOperationOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PERIPHERAL_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal !== undefined) {
    if (options.signal.aborted) controller.abort();
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export async function retryPeripheralOperation<T>(
  operation: () => Promise<T>,
  policy: PeripheralRetryPolicy = {
    attempts: DEFAULT_PERIPHERAL_RETRY_ATTEMPTS,
    delayMs: DEFAULT_PERIPHERAL_RETRY_DELAY_MS,
  },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= policy.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === policy.attempts) break;
      await delay(policy.delayMs);
    }
  }

  throw lastError;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
