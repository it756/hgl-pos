const MONEY = new Intl.NumberFormat("en-ZM", { style: "currency", currency: "ZMW", minimumFractionDigits: 2 });

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? MONEY.format(amount) : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const qty = Number(value);
  return Number.isFinite(qty) ? String(Math.round(qty * 1000) / 1000) : "—";
}

type DbError = { code?: string; message: string };

// Maps the Postgres errors users can actually trigger from forms to
// actionable messages; anything else is surfaced verbatim.
export function friendlyDbError(error: DbError, what: string): string {
  switch (error.code) {
    case "23505":
      return `${what} already exists.`;
    case "23503":
      return `${what} references a record that no longer exists.`;
    case "42501":
      return "You don't have permission to do that.";
    case "23514":
    case "22023":
      return error.message;
    default:
      return `Failed to save ${what.toLowerCase()}: ${error.message}`;
  }
}

export type ActionState = { error: string | null; success: boolean; message?: string };

export const INITIAL_ACTION_STATE: ActionState = { error: null, success: false };

export function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readOptional(formData: FormData, key: string): string | null {
  const value = readField(formData, key);
  return value === "" ? null : value;
}

export function readBool(formData: FormData, key: string): boolean {
  const value = readField(formData, key).toLowerCase();
  return value === "on" || value === "true" || value === "1";
}

export function readNumberOrNull(formData: FormData, key: string): number | null {
  const value = readField(formData, key);
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md text-on-surface";

export const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md font-body-md text-on-surface";
