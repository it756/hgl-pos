import { invoke } from "@tauri-apps/api/core";
import type { TauriSdkDb } from "../db/tauri-sdk";

// Kicks off the real PowerSync `.connect()` in Rust (see src-tauri/src/sync.rs)
// — download/bucket sync only, per the Option B upload-path decision (repo
// scope-out notes). Only meaningful under the Tauri runtime; callers must
// already know `db` is a TauriSdkDb before calling this.
export async function connectPowerSync(db: TauriSdkDb, endpoint: string): Promise<void> {
  await invoke("powersync_connect", { handle: db.raw.rustHandle, endpoint });
}
