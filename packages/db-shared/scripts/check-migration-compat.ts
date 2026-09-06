// Enforces the expand-then-contract migration rule (research.md §6, EC-20):
// a migration must not drop a column/table that a synced client (till)
// might still depend on unless the drop is explicitly marked as having
// cleared its deprecation window.
//
// Marker convention (invented + documented here — no such convention existed
// before this script): the nearest preceding non-blank line of a `DROP
// COLUMN`/`DROP TABLE` statement, scanning upward through a contiguous block
// of `--` comment lines, must contain the literal marker `EXPAND-CONTRACT-OK:`
// followed by a short justification, e.g.:
//
//   -- EXPAND-CONTRACT-OK: deprecated in 0019_foo.sql (released v1.4.0);
//   -- sync-health app_version cohorts confirm zero tills below v1.4.0 as of 2026-xx-xx.
//   alter table public.foo drop column bar;
//
// If the scan hits a non-comment line (or the top of the file) before
// finding the marker, the drop is flagged as a violation.
//
// Known limitation: this is a line-based scanner, not a real SQL parser — a
// `DROP COLUMN`/`DROP TABLE` statement split across multiple lines (the
// keywords not co-located on one line) will not be detected. Every drop in
// this repo's migrations to date is single-line, matching house style, but a
// future migration that wraps one across lines would silently bypass this
// check. `DROP CONSTRAINT` (FK/check constraint drops) is deliberately NOT
// flagged — those don't lose data and several already exist unmarked in this
// repo (0016/0017, dropping a till_id FK for HQ-console sentinel writes);
// EC-20's concern is specifically columns referenced by PowerSync sync
// rules, not constraints.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "EXPAND-CONTRACT-OK:";

const DROP_COLUMN_RE = /alter\s+table\s+\S+\s+drop\s+column\s+(?:if\s+exists\s+)?\S+/i;
const DROP_TABLE_RE = /drop\s+table\s+(?:if\s+exists\s+)?\S+/i;

export type Violation = {
  file: string;
  line: number;
  statement: string;
};

export function checkMigrationFile(fileName: string, contents: string): Violation[] {
  const lines = contents.split(/\r?\n/);
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DROP_COLUMN_RE.test(line) && !DROP_TABLE_RE.test(line)) continue;

    if (!precedingLinesHaveMarker(lines, i)) {
      violations.push({ file: fileName, line: i + 1, statement: line.trim() });
    }
  }

  return violations;
}

function precedingLinesHaveMarker(lines: string[], dropLineIndex: number): boolean {
  for (let j = dropLineIndex - 1; j >= 0; j--) {
    const candidate = lines[j].trim();
    if (candidate.length === 0) continue;
    if (!candidate.startsWith("--")) return false;
    if (candidate.includes(MARKER)) return true;
  }
  return false;
}

export function checkMigrationsDirectory(migrationsDir: string): Violation[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const violations: Violation[] = [];
  for (const file of files) {
    const contents = readFileSync(join(migrationsDir, file), "utf8");
    violations.push(...checkMigrationFile(file, contents));
  }
  return violations;
}

function main(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const targetDir = resolve(process.argv[2] ?? join(__dirname, "../../../supabase/migrations"));

  const violations = checkMigrationsDirectory(targetDir);

  if (violations.length === 0) {
    console.log(`check-migration-compat: clean (${targetDir})`);
    process.exitCode = 0;
    return;
  }

  console.error(`check-migration-compat: ${violations.length} violation(s) in ${targetDir}`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.statement}`);
    console.error(`    -> missing a "-- ${MARKER} ..." comment on the preceding line(s)`);
  }
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
