// Phase 0a spike support commands (T016/T017) ONLY. Not production code —
// remove this module once spike-report.md (T018) is finalized.

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct DbCandidate {
    path: String,
    exists: bool,
    size_bytes: Option<u64>,
}

#[derive(Serialize)]
pub struct LocateDbResult {
    candidates: Vec<DbCandidate>,
}

#[tauri::command]
pub fn spike_prepare_db_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_handle.path().app_data_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Checks every plausible directory the PowerSync Tauri plugin might use for
/// its SQLite file. We don't actually know the plugin's internal path
/// resolution (alpha software) — this walks all of Tauri's own path()
/// resolvers plus common subfolders so the spike can report ground truth
/// instead of a single unverified guess.

#[tauri::command]
pub fn spike_locate_db(app_handle: tauri::AppHandle) -> Result<LocateDbResult, String> {
    let path_resolver = app_handle.path();
    let mut base_dirs: Vec<(&str, std::path::PathBuf)> = Vec::new();

    if let Ok(p) = path_resolver.app_data_dir() {
        base_dirs.push(("app_data_dir", p));
    }
    if let Ok(p) = path_resolver.app_local_data_dir() {
        base_dirs.push(("app_local_data_dir", p));
    }
    if let Ok(p) = path_resolver.app_config_dir() {
        base_dirs.push(("app_config_dir", p));
    }
    if let Ok(p) = path_resolver.app_cache_dir() {
        base_dirs.push(("app_cache_dir", p));
    }
    if let Ok(p) = std::env::current_exe() {
        if let Some(dir) = p.parent() {
            base_dirs.push(("exe_dir", dir.to_path_buf()));
        }
    }
    if let Ok(p) = std::env::current_dir() {
        base_dirs.push(("current_dir", p));
    }

    let filenames = [
        "powersync.db",
        "powersync.db-wal",
        "powersync.db-shm",
        "powersync.sqlite",
        "powersync.sqlite-wal",
        "powersync.sqlite-shm",
    ];
    let mut candidates = Vec::new();

    for (label, dir) in &base_dirs {
        for filename in &filenames {
            let full = dir.join(filename);
            let exists = full.exists();
            let size_bytes = if exists {
                std::fs::metadata(&full).ok().map(|m| m.len())
            } else {
                None
            };
            candidates.push(DbCandidate {
                path: format!("[{label}] {}", full.to_string_lossy()),
                exists,
                size_bytes,
            });
        }
    }

    Ok(LocateDbResult { candidates })
}

#[tauri::command]
pub fn spike_simulate_crash() {
    // Windows has no SIGKILL; abort() skips destructors/flush the same way a
    // real power-loss would — this is the practical equivalent for T017(d).
    std::process::abort();
}

