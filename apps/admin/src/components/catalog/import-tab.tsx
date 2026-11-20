"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importCatalog, type ImportResult } from "../../app/(app)/catalog/actions";
import { buildTemplateCsv, MAX_IMPORT_ROWS, validateImport, type ValidatedRow } from "../../lib/catalog/csv";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function ImportTab() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [busy, startTransition] = useTransition();

  const valid = rows.filter((row) => row.row !== null);
  const invalid = rows.length - valid.length;

  async function handleFile(file: File | undefined) {
    setResults(null);
    if (file === undefined) return;
    setFileName(file.name);
    const validation = validateImport(await file.text());
    setFatal(validation.fatal);
    setRows(validation.rows);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([buildTemplateCsv()], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "catalog-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function submit() {
    startTransition(async () => {
      const payload = valid.flatMap((entry) => (entry.row === null ? [] : [{ line: entry.line, row: entry.row }]));
      const response = await importCatalog(payload);
      setFatal(response.error);
      setResults(response.results);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-md font-body-md text-on-surface-variant">
        Columns: <code>code, name, category_code, unit_type, barcode, track_batch, track_expiry, price</code>. Existing SKUs are matched by
        code and updated. Prices go through the normal audited price-change flow as a chain-wide price effective immediately. Up to{" "}
        {MAX_IMPORT_ROWS} rows per file.
      </p>
      <div className="flex flex-wrap items-end gap-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="catalog-csv">CSV file</Label>
          <input id="catalog-csv" type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.target.files?.[0])} />
        </div>
        <Button type="button" variant="outline" onClick={downloadTemplate}>
          Download template
        </Button>
      </div>

      {fatal !== null && <p role="alert" className="text-body-md font-body-md text-destructive">{fatal}</p>}

      {rows.length > 0 && results === null && (
        <>
          <div className="flex items-center gap-sm">
            <p className="text-body-md font-body-md text-on-surface">
              {fileName}: {valid.length} valid, {invalid} with errors.
            </p>
            <Button type="button" disabled={busy || valid.length === 0} onClick={submit}>
              {busy ? "Importing…" : `Import ${valid.length} row(s)`}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.line}>
                  <TableCell>{entry.line}</TableCell>
                  <TableCell>{entry.row?.code ?? "—"}</TableCell>
                  <TableCell>{entry.row?.name ?? "—"}</TableCell>
                  <TableCell>{entry.row?.category_code ?? "—"}</TableCell>
                  <TableCell>{entry.row?.barcode ?? "—"}</TableCell>
                  <TableCell>{entry.row?.price ?? "—"}</TableCell>
                  <TableCell>
                    {entry.errors.length === 0 ? (
                      <Badge variant="success">OK</Badge>
                    ) : (
                      <span className="text-body-sm text-destructive">{entry.errors.join("; ")}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {results !== null && (
        <>
          <p role="status" className="text-body-md font-body-md text-on-surface">
            Imported: {results.filter((r) => r.outcome === "created").length} created, {results.filter((r) => r.outcome === "updated").length}{" "}
            updated, {results.filter((r) => r.outcome === "error").length} failed.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.line}>
                  <TableCell>{result.line}</TableCell>
                  <TableCell>{result.code}</TableCell>
                  <TableCell>
                    <Badge variant={result.outcome === "error" ? "destructive" : "success"}>{result.outcome}</Badge>
                  </TableCell>
                  <TableCell>{result.notes.join("; ") || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
