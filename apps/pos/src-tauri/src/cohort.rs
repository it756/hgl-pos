// Canary rollout cohort config (T126, US8). Each store's installer bundles
// `resources/cohort.config.json` with a fixed channel baked in at build
// time — this is how the fleet ever runs two versions concurrently
// (research.md §6 / EC-20): the pilot store's installer ships with
// `"channel": "canary"`, every other store's installer keeps `"stable"`.
// There is no runtime UI to flip this on-till; changing a store's cohort is
// a deliberate re-provisioning/re-install action, not a togglable setting.
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CohortConfig {
    /// "stable" or "canary" — selects which updater endpoint path this install polls.
    pub channel: String,
    /// Optional store_id (uuid) this install was built for. Diagnostic/audit only —
    /// endpoint routing is keyed purely on `channel`, never on `store_id`.
    pub store_id: Option<String>,
}

impl Default for CohortConfig {
    fn default() -> Self {
        Self {
            channel: "stable".to_string(),
            store_id: None,
        }
    }
}

/// Reads the bundled cohort config resource. Falls back to the "stable"
/// default on any error (missing resource, unreadable file, malformed JSON)
/// rather than failing app startup — an unreadable cohort config must never
/// block the till from opening (Principle I: offline-first, no hard
/// dependency on ancillary config for the core sale flow).
pub fn load_cohort_config(app: &AppHandle) -> CohortConfig {
    let resolved = app
        .path()
        .resolve("resources/cohort.config.json", BaseDirectory::Resource);

    let Ok(path) = resolved else {
        return CohortConfig::default();
    };

    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => CohortConfig::default(),
    }
}

/// Builds the updater endpoint URL for a given channel. tauri-plugin-updater
/// endpoint templates only support the built-in `{{target}}`/`{{arch}}`/
/// `{{current_version}}` variables (custom variables are NOT supported —
/// see https://v2.tauri.app/plugin/updater/#endpoints), so the channel is
/// spliced into the literal path segment here instead of templated, matching
/// the plugin docs' own "separate release channels" recipe.
pub fn channel_endpoint(channel: &str) -> String {
    format!("https://updates.harvestgroup.internal/pos/{channel}/{{{{target}}}}/{{{{current_version}}}}")
}

#[tauri::command]
pub fn get_cohort_channel(state: tauri::State<CohortConfig>) -> CohortConfig {
    state.inner().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_endpoint_splices_channel_and_keeps_template_vars() {
        assert_eq!(
            channel_endpoint("canary"),
            "https://updates.harvestgroup.internal/pos/canary/{{target}}/{{current_version}}"
        );
    }

    #[test]
    fn default_cohort_config_is_stable_with_no_store() {
        let config = CohortConfig::default();
        assert_eq!(config.channel, "stable");
        assert_eq!(config.store_id, None);
    }
}
