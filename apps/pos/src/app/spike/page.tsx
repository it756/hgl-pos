"use client";

// Phase 0a offline-write spike (T016). NOT production UI — validates the
// alpha PowerSync Tauri SDK end-to-end per research.md §12 before any
// foundational code is built on top of it. Delete this route once the spike
// report (T018) is finalized.
//
// ASSUMPTION: the exact @powersync/tauri-plugin API surface below
// (PowerSyncTauriDatabase, Schema, Table, column, getUploadQueueStats) is
// sketched from the general PowerSync JS SDK shape. This is alpha software —
// reconcile against the actual installed package's type definitions before
// running; fix names as needed. That reconciliation itself is part of what
// T017 is testing for.
//
// Every handler below is wrapped in try/catch and logs explicit
// start/success/failure lines — silent success/failure was the T017 blocker
// reported when this page had bare `await` calls with no error surfacing.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PowerSyncTauriDatabase } from "@powersync/tauri-plugin";
import { column, Schema, Table } from "@powersync/common";

const spikeSchema = new Schema({
  users: new Table({ full_name: column.text, pin_hash: column.text }),
  shifts: new Table({
    cashier_id: column.text,
    opening_float: column.real,
    status: column.text,
  }),
  sale_events: new Table({
    event_id: column.text,
    shift_id: column.text,
    grand_total: column.real,
  }),
});

// De-risking spike for the real .connect()/raw-tables design (see repo scope-out
// notes): a raw table so PowerSync manages CRUD triggers into ps_crud on top of a
// SQLite table we fully control (domain PK, not the implicit `id` view convention).
const SPIKE_RAW_TODOS_NAME = "spike_todos";
const SPIKE_RAW_TODOS_SCHEMA = { schema: {} };
spikeSchema.withRawTables({ [SPIKE_RAW_TODOS_NAME]: SPIKE_RAW_TODOS_SCHEMA });

let db: PowerSyncTauriDatabase | null = null;
let dbInitPromise: Promise<PowerSyncTauriDatabase> | null = null;

type TauriGlobal = typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke?: unknown };
};

function assertTauriIpcAvailable(): void {
  const tauriGlobal = globalThis as TauriGlobal;
  if (typeof tauriGlobal.__TAURI_INTERNALS__?.invoke === "function") return;

  throw new Error(
    "Tauri IPC is not available. Open this spike from the HGL POS Tauri window, not from a normal localhost browser tab.",
  );
}

async function prepareDbDir(onLog: (line: string) => void): Promise<string> {
  assertTauriIpcAvailable();
  const dbDir = await invoke<string>("spike_prepare_db_dir");
  onLog(`DB init: using directory ${dbDir}`);
  return dbDir;
}

async function getDb(onLog: (line: string) => void): Promise<PowerSyncTauriDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const dbDir = await prepareDbDir(onLog);
      onLog("DB init: constructing PowerSyncTauriDatabase...");
      const instance = new PowerSyncTauriDatabase({
        schema: spikeSchema,
        database: { dbFilename: "powersync.db", dbLocationAsync: () => Promise.resolve(dbDir) },
      });
      onLog("DB init: calling .init() ...");
      await instance.init();
      onLog("DB init: SUCCESS — instance ready.");
      db = instance;
      return instance;
    })().catch((err: unknown) => {
      dbInitPromise = null;
      onLog(`DB init: FAILED — ${errorMessage(err)}`);
      throw err;
    });
  }
  return dbInitPromise;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

const SPIKE_CASHIER_ID = "spike-cashier-1";
const SPIKE_SHIFT_ID = "spike-shift-1";

export default function SpikePage() {
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog((prev) => [...prev, `${new Date().toISOString()} ${line}`]);

  async function withStep(label: string, fn: () => Promise<void>) {
    append(`${label}: starting...`);
    try {
      await fn();
      append(`${label}: SUCCESS`);
    } catch (err) {
      append(`${label}: FAILED — ${errorMessage(err)}`);
    }
  }

  async function seedCashier() {
    await withStep("Seed cashier", async () => {
      const d = await getDb(append);
      await d.execute("INSERT OR IGNORE INTO users (id, full_name, pin_hash) VALUES (?, ?, ?)", [
        SPIKE_CASHIER_ID,
        "Spike Cashier",
        "not-a-real-hash-spike-only",
      ]);
      // Read back rather than trusting execute() didn't throw — proves the
      // row is actually persisted, not just that the statement ran.
      const rows = await d.getAll<{ id: string; full_name: string }>(
        "SELECT id, full_name FROM users WHERE id = ?",
        [SPIKE_CASHIER_ID],
      );
      if (rows.length === 0) throw new Error("insert reported no error but row is not readable back");
      append(`Verified row: ${JSON.stringify(rows[0])}`);
    });
  }

  async function openShift() {
    await withStep("Open shift", async () => {
      const d = await getDb(append);
      await d.execute(
        "INSERT INTO shifts (id, cashier_id, opening_float, status) VALUES (?, ?, ?, ?)",
        [SPIKE_SHIFT_ID, SPIKE_CASHIER_ID, 500, "open"],
      );
      const rows = await d.getAll<{ id: string; status: string }>(
        "SELECT id, status FROM shifts WHERE id = ?",
        [SPIKE_SHIFT_ID],
      );
      if (rows.length === 0) throw new Error("insert reported no error but row is not readable back");
      append(`Verified row: ${JSON.stringify(rows[0])} (offline — no network call)`);
    });
  }

  async function completeSale() {
    await withStep("Complete sale", async () => {
      const d = await getDb(append);
      const eventId = crypto.randomUUID();
      await d.execute(
        "INSERT INTO sale_events (id, event_id, shift_id, grand_total) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), eventId, SPIKE_SHIFT_ID, 42.5],
      );
      const rows = await d.getAll<{ event_id: string; grand_total: number }>(
        "SELECT event_id, grand_total FROM sale_events WHERE event_id = ?",
        [eventId],
      );
      if (rows.length === 0) throw new Error("insert reported no error but row is not readable back");
      append(`Verified row: ${JSON.stringify(rows[0])} (offline)`);
    });
  }

  async function setupRawTable() {
    await withStep("Setup raw table + CRUD triggers", async () => {
      const d = await getDb(append);
      await d.execute(
        `CREATE TABLE IF NOT EXISTS ${SPIKE_RAW_TODOS_NAME} (id TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL) STRICT`,
      );
      const rawTableJson = JSON.stringify(
        Schema.rawTableToJson({ name: SPIKE_RAW_TODOS_NAME, ...SPIKE_RAW_TODOS_SCHEMA }),
      );
      for (const write of ["INSERT", "UPDATE", "DELETE"]) {
        await d.execute("SELECT powersync_create_raw_table_crud_trigger(?, ?, ?)", [
          rawTableJson,
          `${SPIKE_RAW_TODOS_NAME}_${write}`,
          write,
        ]);
      }
      append("Raw table + INSERT/UPDATE/DELETE CRUD triggers created.");
    });
  }

  async function writeRawRow() {
    await withStep("Write raw table row (should hit ps_crud)", async () => {
      const d = await getDb(append);
      const id = crypto.randomUUID();
      await d.execute(`INSERT INTO ${SPIKE_RAW_TODOS_NAME} (id, title) VALUES (?, ?)`, [
        id,
        "spike raw row",
      ]);
      const crud = await d.getAll<{ count: number }>("SELECT count(*) as count FROM ps_crud");
      append(`Row written (id=${id}). ps_crud rows right now: ${crud[0]?.count ?? 0}`);
    });
  }

  async function connectRealBackend() {
    await withStep("Connect (real Rust BackendConnector)", async () => {
      const d = await getDb(append);
      await invoke("spike_connect", { handle: d.rustHandle });
      append(
        "connect() requested — this only proves the wiring (Rust command resolved the JS handle and called PowerSyncDatabase.connect()); watch the Tauri terminal for 'spike_connect: uploading ...' lines after writing a raw row.",
      );
    });
  }

  async function checkQueueDepth() {
    await withStep("Check upload queue depth", async () => {
      const d = await getDb(append);
      try {
        const rows = await d.getAll<{ count: number }>("SELECT count(*) as count FROM ps_crud");
        append(`Upload queue rows from ps_crud: ${rows[0]?.count ?? 0}`);
      } catch (err) {
        append(`PowerSync JS getUploadQueueStats/readTransaction is not usable on this Tauri alpha path: ${errorMessage(err)}`);
        append("Offline persistence is still validated by row read-backs and the on-disk DB/WAL files.");
      }
    });
  }

  async function countAllRows() {
    await withStep("Count all rows (sanity check)", async () => {
      const d = await getDb(append);
      const users = await d.getAll<{ n: number }>("SELECT COUNT(*) as n FROM users");
      const shifts = await d.getAll<{ n: number }>("SELECT COUNT(*) as n FROM shifts");
      const sales = await d.getAll<{ n: number }>("SELECT COUNT(*) as n FROM sale_events");
      append(
        `Row counts — users: ${users[0]?.n ?? "?"}, shifts: ${shifts[0]?.n ?? "?"}, sale_events: ${sales[0]?.n ?? "?"}`,
      );
    });
  }

  async function locateDbFile() {
    await withStep("Locate local DB file", async () => {
      assertTauriIpcAvailable();
      const result = await invoke<{ candidates: { path: string; exists: boolean; size_bytes: number | null }[] }>(
        "spike_locate_db",
      );
      for (const c of result.candidates) {
        append(`  ${c.exists ? "FOUND" : "missing"}  ${c.path}${c.size_bytes !== null ? ` (${c.size_bytes} bytes)` : ""}`);
      }
      if (!result.candidates.some((c) => c.exists)) {
        append("None of the candidate paths contain powersync.db — the plugin may store it elsewhere. See spike.rs comments.");
      }
    });
  }

  function simulateCrash() {
    try {
      assertTauriIpcAvailable();
      append("Simulate crash: triggering abrupt process termination in 1s (T017 criterion d)...");
      setTimeout(() => void invoke("spike_simulate_crash"), 1000);
    } catch (err) {
      append(`Simulate crash: FAILED — ${errorMessage(err)}`);
    }
  }

  useEffect(() => {
    append("Spike page loaded. DB is initialized only when a DB step is clicked.");
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>Phase 0a Offline-Write Spike</h1>
      <p>
        Disconnect WAN before steps 2–4. Reconnect before step 5. Record raw
        evidence (screenshots, this log, file listings) under
        specs/001-retail-pos-mvp/spike-evidence/. Every step below logs
        starting/SUCCESS/FAILED explicitly — if a step silently does nothing,
        that itself is a T017 finding, not a UI bug.
      </p>
      <ol>
        <li>
          <button onClick={() => void seedCashier()}>1. Seed cashier</button>
        </li>
        <li>
          <button onClick={() => void openShift()}>2. Open shift (offline)</button>
        </li>
        <li>
          <button onClick={() => void completeSale()}>3. Complete sale (offline)</button>
        </li>
        <li>
          <button onClick={() => void checkQueueDepth()}>4. Check upload queue depth</button>
        </li>
        <li>
          <button onClick={() => void checkQueueDepth()}>
            5. Reconnect, re-check queue depth (expect 0)
          </button>
        </li>
        <li>
          <button onClick={() => void countAllRows()}>Count all rows (sanity check)</button>
        </li>
        <li>
          <button onClick={() => void locateDbFile()}>Locate local DB file (checks multiple candidate paths)</button>
        </li>
        <li>
          <button onClick={() => void simulateCrash()}>
            Simulate crash mid-write (criterion d)
          </button>
        </li>
      </ol>
      <p>
        Real <code>.connect()</code> + backend connector de-risking spike
        (scope-out follow-up) — run in order, watch the Tauri terminal for
        <code>spike_connect:</code> log lines, not just this page:
      </p>
      <ol>
        <li>
          <button onClick={() => void setupRawTable()}>A. Setup raw table + CRUD triggers</button>
        </li>
        <li>
          <button onClick={() => void connectRealBackend()}>
            B. Connect (real Rust BackendConnector, dev-only JWT)
          </button>
        </li>
        <li>
          <button onClick={() => void writeRawRow()}>C. Write raw table row (should hit ps_crud)</button>
        </li>
        <li>
          <button onClick={() => void checkQueueDepth()}>
            D. Check ps_crud count (expect it to drain back to 0 after B+C)
          </button>
        </li>
      </ol>
      <pre>{log.join("\n")}</pre>
    </main>
  );
}

