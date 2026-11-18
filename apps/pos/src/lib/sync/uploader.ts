import type { AnyTillEvent } from "@hgl/events";
import type { SyncUploader } from "./engine";

// Real event-upload path (Gap A) — POSTs each queued event straight to its
// matching idempotent ingest RPC (supabase/migrations/0002_event_tables.sql),
// bypassing PowerSync's own CRUD queue entirely (Option B: PowerSync .connect()
// stays download-only, see repo scope-out notes). `on conflict (event_id) do
// nothing` in every RPC makes retrying an already-uploaded event a safe no-op.
const EVENT_KIND_TO_INGEST_RPC: Record<AnyTillEvent["kind"], string> = {
  sale: "ingest_sale_event",
  shift: "ingest_shift_event",
  stock: "ingest_stock_event",
  transfer: "ingest_transfer_event",
  adjustment: "ingest_adjustment_event",
};

export type SupabaseSyncUploaderOptions = {
  supabaseUrl: string;
  anonKey: string;
  /** Must return a currently-valid device-role JWT (see auth/device-session.ts). */
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
};

export class SupabaseSyncUploader implements SyncUploader {
  readonly #supabaseUrl: string;
  readonly #anonKey: string;
  readonly #getAccessToken: () => Promise<string>;
  readonly #fetch: typeof fetch;

  constructor(options: SupabaseSyncUploaderOptions) {
    this.#supabaseUrl = options.supabaseUrl;
    this.#anonKey = options.anonKey;
    this.#getAccessToken = options.getAccessToken;
    // Native fetch throws "Illegal invocation" unless bound to a Window-like receiver.
    this.#fetch = (options.fetchImpl ?? fetch).bind(globalThis);
  }

  async upload(events: AnyTillEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Attempt every event even once one fails — a single permanently-
    // rejecting event (e.g. a 409 conflict) must not stop later, unrelated
    // events in the same batch from ever reaching the server. The whole
    // call still throws (safe for callers still using the whole-batch
    // upload() path — see SyncEngine's fallback when uploadOne isn't used)
    // but only after every event has had its own attempt.
    const failures: string[] = [];
    for (const event of events) {
      try {
        await this.uploadOne(event);
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length}/${events.length} event(s) failed to upload: ${failures.join("; ")}`);
    }
  }

  // Preferred path (see SyncUploader.uploadOne's doc comment in engine.ts):
  // SyncEngine.drainOnce() calls this per-row so one permanently-failing
  // event can't prevent other queued events from ever being marked uploaded.
  async uploadOne(event: AnyTillEvent): Promise<void> {
    const accessToken = await this.#getAccessToken();
    const rpc = EVENT_KIND_TO_INGEST_RPC[event.kind];
    // `kind` is a TS-only discriminator, not a column on any *_events table.
    const { kind: _kind, ...rowData } = event;

    const response = await this.#fetch(`${this.#supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: this.#anonKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ row_data: rowData }),
    });

    if (!response.ok) {
      throw new Error(
        `event upload failed (kind=${event.kind}, event_id=${event.event_id}): HTTP ${response.status}`,
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
