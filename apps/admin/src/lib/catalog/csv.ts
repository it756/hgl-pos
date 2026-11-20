import { z } from "zod";

// RFC 4180-style parser: quoted fields, "" escapes, CR/LF/CRLF line endings,
// newlines inside quotes. Blank lines are dropped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0]?.trim() === "")) rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      if (input[index + 1] === "\n") index += 1;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export const IMPORT_COLUMNS = ["code", "name", "category_code", "unit_type", "barcode", "track_batch", "track_expiry", "price"] as const;
export const MAX_IMPORT_ROWS = 500;

const csvBoolean = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, ctx) => {
    if (value === "" || ["false", "no", "0", "n"].includes(value)) return false;
    if (["true", "yes", "1", "y"].includes(value)) return true;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${value}" is not a yes/no value` });
    return z.NEVER;
  });

export const ImportRowSchema = z.object({
  code: z.string().trim().min(1, "code is required").max(40),
  name: z.string().trim().min(1, "name is required").max(200),
  category_code: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value)),
  unit_type: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === "" ? "quantity" : value))
    .pipe(z.enum(["quantity", "weight"], { errorMap: () => ({ message: "unit_type must be quantity or weight" }) })),
  barcode: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().regex(/^[0-9A-Za-z-]{4,64}$/, "barcode must be 4-64 letters/digits").nullable()),
  track_batch: csvBoolean,
  track_expiry: csvBoolean,
  price: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "price must be a non-negative number" });
        return z.NEVER;
      }
      return Math.round(parsed * 10000) / 10000;
    }),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export type ValidatedRow = { line: number; row: ImportRow | null; errors: string[] };

export function validateImport(text: string): { rows: ValidatedRow[]; fatal: string | null } {
  const [header, ...body] = parseCsv(text);
  if (header === undefined) return { rows: [], fatal: "The file is empty." };

  const normalized = header.map((column) => column.trim().toLowerCase());
  const missing = ["code", "name"].filter((column) => !normalized.includes(column));
  if (missing.length > 0) return { rows: [], fatal: `Missing required column(s): ${missing.join(", ")}` };
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], fatal: `Too many rows (${body.length}); the limit is ${MAX_IMPORT_ROWS} per import.` };

  const seenCodes = new Map<string, number>();
  const rows = body.map((cells, index): ValidatedRow => {
    const line = index + 2;
    const record: Record<string, string> = {};
    for (const column of IMPORT_COLUMNS) {
      const position = normalized.indexOf(column);
      record[column] = position === -1 ? "" : (cells[position] ?? "");
    }
    const parsed = ImportRowSchema.safeParse(record);
    if (!parsed.success) return { line, row: null, errors: parsed.error.issues.map((issue) => issue.message) };

    const duplicateOf = seenCodes.get(parsed.data.code.toLowerCase());
    if (duplicateOf !== undefined) return { line, row: null, errors: [`duplicate code (also on line ${duplicateOf})`] };
    seenCodes.set(parsed.data.code.toLowerCase(), line);
    return { line, row: parsed.data, errors: [] };
  });
  return { rows, fatal: null };
}

export function buildTemplateCsv(): string {
  return `${IMPORT_COLUMNS.join(",")}\nSKU-0001,"Maize Meal 10kg",STAPLES,quantity,6001234567890,no,no,145.00\nSKU-0002,"Bananas (per kg)",PRODUCE,weight,,no,yes,28.50\n`;
}
