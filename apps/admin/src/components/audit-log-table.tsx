"use client";

import { useMemo, useState } from "react";
import type { AuditLogEntry } from "../lib/audit/unified-audit";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export type AuditLogTableProps = {
  entries: AuditLogEntry[];
};

export function AuditLogTable({ entries }: AuditLogTableProps) {
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const entityTypes = useMemo(() => {
    const seen = new Set(entries.map((entry) => entry.entity_type));
    return ["all", ...Array.from(seen).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (entityTypeFilter !== "all" && entry.entity_type !== entityTypeFilter) return false;
      if (term.length === 0) return true;
      return (
        entry.action.toLowerCase().includes(term) ||
        (entry.actor_name?.toLowerCase().includes(term) ?? false) ||
        entry.entity_id.toLowerCase().includes(term)
      );
    });
  }, [entries, entityTypeFilter, search]);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Audit log</h1>
        <div className="flex items-center gap-2">
          <select
            value={entityTypeFilter}
            onChange={(event) => setEntityTypeFilter(event.target.value)}
            className="h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md font-body-md text-on-surface"
          >
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type === "all" ? "All entity types" : type}
              </option>
            ))}
          </select>
          <Input placeholder="Search action, actor, id…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-64" />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Timestamp</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((entry) => (
            <TableRow key={entry.audit_id}>
              <TableCell>{new Date(entry.server_ts).toLocaleString()}</TableCell>
              <TableCell>{entry.actor_name ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="secondary">{entry.action}</Badge>
              </TableCell>
              <TableCell>
                {entry.entity_type} <span className="text-on-surface-variant">({entry.entity_id.slice(0, 8)}…)</span>
              </TableCell>
              <TableCell className="max-w-md truncate text-label-sm font-label-sm text-on-surface-variant" title={JSON.stringify({ old: entry.old_value, new: entry.new_value })}>
                {summarizeChange(entry)}
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-on-surface-variant">
                No audit entries found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function summarizeChange(entry: AuditLogEntry): string {
  const parts: string[] = [];
  if (entry.new_value !== null) {
    for (const [key, value] of Object.entries(entry.new_value)) {
      if (key === "store_id" || key === "actor_user_id") continue;
      parts.push(`${key}: ${JSON.stringify(value)}`);
      if (parts.length >= 3) break;
    }
  }
  return parts.length > 0 ? parts.join(", ") : "—";
}
