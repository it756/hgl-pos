import type { IDb } from "../db";

// Deterministic per-till event IDs (RFC 4122 UUID v5) so `event_id uuid` stays
// unchanged. Namespacing by till_id (not just an incrementing counter) is
// what actually prevents collisions between independently-provisioned tills
// that happen to share disk-image history (EC-07) — each till gets its own
// till_id from T046's provisioning flow even when cloned from the same image.
const EVENT_ID_NAMESPACE = "6f9c3a2e-6b3e-5b1a-9e3f-8f2b1c4d5e6a";

export async function nextEventId(db: IDb, tillId: string): Promise<string> {
  await ensureLocalSequenceTable(db);

  await db.insert(
    `INSERT INTO local_event_sequence (till_id, next_seq) VALUES (?, 0)
    ON CONFLICT(till_id) DO NOTHING`,
    [tillId],
  );

  const rows = await db.query<{ next_seq: number }>(
    `UPDATE local_event_sequence SET next_seq = next_seq + 1 WHERE till_id = ? RETURNING next_seq`,
    [tillId],
  );
  const sequence = rows[0]?.next_seq;
  if (sequence === undefined) {
    throw new Error(`nextEventId: failed to increment local sequence for till ${tillId}`);
  }

  return uuidV5(`${tillId}:${sequence}`);
}

export async function ensureLocalSequenceTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_event_sequence (
      till_id TEXT PRIMARY KEY,
      next_seq INTEGER NOT NULL DEFAULT 0
    )`,
  );
}

export async function uuidV5(name: string, namespace: string = EVENT_ID_NAMESPACE): Promise<string> {
  const namespaceBytes = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const combined = new Uint8Array(namespaceBytes.length + nameBytes.length);
  combined.set(namespaceBytes, 0);
  combined.set(nameBytes, namespaceBytes.length);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", combined));
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuid(bytes);
}

function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
