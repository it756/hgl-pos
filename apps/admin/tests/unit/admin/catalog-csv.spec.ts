import { describe, expect, it } from "vitest";
import { parseCsv, validateImport, buildTemplateCsv, MAX_IMPORT_ROWS } from "../../../src/lib/catalog/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas/newlines and CRLF", () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\nlast,,\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["last", "", ""],
    ]);
  });

  it("strips a UTF-8 BOM and handles a missing trailing newline", () => {
    expect(parseCsv("\uFEFFcode,name\nA,B")).toEqual([
      ["code", "name"],
      ["A", "B"],
    ]);
  });
});

describe("validateImport", () => {
  it("accepts the downloadable template", () => {
    const { rows, fatal } = validateImport(buildTemplateCsv());
    expect(fatal).toBeNull();
    expect(rows.every((row) => row.errors.length === 0)).toBe(true);
    expect(rows[1]?.row).toMatchObject({ unit_type: "weight", track_expiry: true, barcode: null, price: 28.5 });
  });

  it("reports per-row errors with file line numbers and catches duplicate codes", () => {
    const csv = ["code,name,unit_type,track_batch,price", "A1,Apple,each,no,1", "B1,,quantity,maybe,-2", "A1,Again,quantity,yes,"].join("\n");
    const { rows } = validateImport(csv);
    expect(rows.map((row) => row.line)).toEqual([2, 3, 4]);
    expect(rows[0]?.errors.join()).toMatch(/unit_type/);
    expect(rows[1]?.errors.join()).toMatch(/name is required/);
    expect(rows[1]?.errors.join()).toMatch(/not a yes\/no value/);
    expect(rows[1]?.errors.join()).toMatch(/price must be/);
    expect(rows[2]?.errors).toEqual([]);
  });

  it("flags duplicates only after the first valid occurrence", () => {
    const { rows } = validateImport("code,name\nX,One\nx,Two");
    expect(rows[1]?.errors[0]).toMatch(/duplicate code \(also on line 2\)/);
  });

  it("rejects files missing required columns or over the row limit", () => {
    expect(validateImport("name\nfoo").fatal).toMatch(/code/);
    expect(validateImport("").fatal).toMatch(/empty/);
    const big = ["code,name", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `C${i},N${i}`)].join("\n");
    expect(validateImport(big).fatal).toMatch(/Too many rows/);
  });
});
