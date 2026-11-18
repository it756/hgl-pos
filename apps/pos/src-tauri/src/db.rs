// SQLCipher / on-till DB encryption key management (T133, Constitution
// Principle VII: "OS-level disk encryption or SQLCipher").
//
// HONEST STATUS — read before assuming SQLCipher is active end-to-end:
//
// The active SDK path (per T036/research.md §1) is the PowerSync Tauri SDK:
// JS package `@powersync/tauri-plugin` 0.0.6 wrapping Rust crate
// `tauri-plugin-powersync` 0.0.6. Both were inspected directly in this repo
// (`apps/pos/node_modules/@powersync/{common,tauri-plugin}/lib/*.d.ts` and
// `~/.cargo/registry/src/.../tauri-plugin-powersync-0.0.6`) — neither exposes
// an encryption-key, PRAGMA, or SQLCipher hook anywhere in their public
// surface. The JS `TauriSQLOpenOptions`/`SQLOpenOptions` open-options only
// accept `dbFilename`/`dbLocationAsync`; the Rust IPC `OpenDatabase` command
// only accepts `name`+`schema`. This is alpha software (research.md §1) and
// the gap is architectural, not a missing config flag — there is currently
// NO way to hand this plugin an SQLCipher key from Rust or JS.
//
// Therefore: SQLCipher is NOT wired on the active connection today. Claiming
// otherwise would be a false security claim, which is worse than an honestly
// flagged gap (per the task brief). What IS implemented and independently
// verifiable below is the DPAPI-backed key management half of T133: a
// per-till 256-bit key is generated once, protected at rest with Windows
// DPAPI (`CryptProtectData`, machine/user-bound so the encrypted blob is
// useless if copied to another PC — "key never leaves the machine"), and
// persisted under the app data directory. This key is ready to hand to
// SQLCipher (as a `PRAGMA key`) the moment one of the following lands:
//   1. an upstream `tauri-plugin-powersync` release exposes a key hook, or
//   2. a raw `rusqlite`/`libsqlcipher-sys` side-channel is added that opens
//      the same on-disk file independently (needs its own design pass — the
//      PowerSync plugin, not this code, owns the actual SQLite connection).
// Until then, Constitution Principle VII's documented fallback — OS-level
// disk encryption (BitLocker) on the Windows till — is the operative
// protection for the on-till database, not SQLCipher.

use std::fs;
use std::path::PathBuf;

use rand_core::{OsRng, RngCore};
use tauri::Manager;

const KEY_FILE_NAME: &str = "db-encryption-key.dpapi";
const KEY_LEN_BYTES: usize = 32;

fn key_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(KEY_FILE_NAME))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(target_os = "windows")]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe fn blob(bytes: &mut [u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_mut_ptr(),
        }
    }

    /// Encrypts `plaintext` with Windows DPAPI, bound to the current
    /// user+machine (no explicit entropy/optional-entropy is used, matching
    /// the default CryptProtectData scope). The returned blob is only
    /// decryptable on this machine, by this Windows user account.
    pub fn protect(mut plaintext: Vec<u8>) -> Result<Vec<u8>, String> {
        unsafe {
            let input = blob(&mut plaintext);
            let mut output: CRYPT_INTEGER_BLOB = std::mem::zeroed();
            let ok = CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("CryptProtectData failed".to_string());
            }
            let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut core::ffi::c_void);
            Ok(result)
        }
    }

    pub fn unprotect(mut ciphertext: Vec<u8>) -> Result<Vec<u8>, String> {
        unsafe {
            let input = blob(&mut ciphertext);
            let mut output: CRYPT_INTEGER_BLOB = std::mem::zeroed();
            let ok = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return Err("CryptUnprotectData failed".to_string());
            }
            let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as *mut core::ffi::c_void);
            Ok(result)
        }
    }
}

// Non-Windows builds (e.g. `cargo test` on a contributor's non-Windows
// machine, or CI) get a clear error instead of a link failure — DPAPI is
// Windows-only and this product's ratified terminal OS is Windows anyway
// (Constitution §Additional Constraints).
#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn protect(_plaintext: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("DPAPI key protection is only available on Windows".to_string())
    }

    pub fn unprotect(_ciphertext: Vec<u8>) -> Result<Vec<u8>, String> {
        Err("DPAPI key protection is only available on Windows".to_string())
    }
}

/// Returns this till's local DB encryption key as a lowercase hex string,
/// generating and DPAPI-protecting it on first call. Idempotent: subsequent
/// calls decrypt and return the same key. See module doc comment for what
/// this key is (and is not yet) wired to.
#[tauri::command]
pub fn get_or_create_db_encryption_key(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = key_file_path(&app_handle)?;

    if path.exists() {
        let protected = fs::read(&path).map_err(|err| err.to_string())?;
        let plaintext = dpapi::unprotect(protected)?;
        return Ok(hex_encode(&plaintext));
    }

    let mut key = vec![0u8; KEY_LEN_BYTES];
    OsRng.fill_bytes(&mut key);
    let protected = dpapi::protect(key.clone())?;
    fs::write(&path, protected).map_err(|err| err.to_string())?;
    Ok(hex_encode(&key))
}

#[cfg(test)]
mod tests {
    use super::hex_encode;

    #[test]
    fn hex_encode_formats_bytes_lowercase() {
        assert_eq!(hex_encode(&[0x0a, 0xff, 0x00]), "0aff00");
    }
}
