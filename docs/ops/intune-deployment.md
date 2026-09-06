# Intune Deployment Runbook

Fleet MDM for the POS terminal fleet is **Microsoft Intune** (Constitution
Additional Constraints), used for silent remote deployment, kiosk
configuration, and native-shell installer distribution.

## Enrolment

1. Enrol each till into Intune (Azure AD join or hybrid join, per Harvest
   Group's existing tenant policy — not specific to this project).
2. Assign the till to a device group scoped by store (e.g. `POS-<store
   code>`) so store-level and fleet-wide policies can target correctly —
   this store grouping is also how the canary rollout cohort mapping
   (`docs/ops/canary.md`) is kept consistent with the physical fleet.

## Policy deployment

1. **Kiosk configuration**: deploy the Assigned Access / Shell Launcher
   policy from `docs/ops/kiosk-config.md` via an Intune configuration
   profile (Settings Catalog or a custom OMA-URI profile for Shell
   Launcher). Verify against the checklist in that runbook after each
   policy change, not just at initial rollout.
2. **App installer distribution (native shell / Tier 2 updates)**: package
   the signed Tauri installer (`.msi`/`.exe`) as a Win32 app in Intune.
   Native-shell updates are rare (per the constitution's OTA tiering — most
   updates are Tier 1, delivered by Tauri's own updater plugin, not Intune)
   — reserve Intune app deployment for shell-level changes only.
3. **Network/firewall policy**: ensure the till's configuration profile
   permits outbound HTTPS to the Supabase project URL and the Tauri updater
   endpoint (`apps/pos/src-tauri/tauri.conf.json`'s `plugins.updater.
   endpoints`) — a till that can't reach either will still trade fully
   offline (Constitution Principle I) but won't ever sync or receive
   updates.

## Canary/cohort awareness

Per `docs/ops/canary.md`, a till's update channel (`stable` vs `canary`) is
baked into its installer at build time (`apps/pos/src-tauri/resources/
cohort.config.json`), not toggled via Intune. Intune's job is distributing
the *correct build* to the *correct device group* — never mix a canary
installer into a stable store's device group by mistake; double-check the
Intune assignment matches the intended rollout cohort before every push.

## Rollback

If a deployed policy or installer causes a fleet-wide issue:

1. Revert the Intune assignment/policy to the last known-good version.
2. For a bad native-shell installer, Intune's own app version history allows
   re-pushing the prior `.msi` — this does NOT roll back local SQLite schema
   changes, so confirm the migration compatibility linter
   (`packages/db-shared/scripts/check-migration-compat.ts`) had already
   verified backward compatibility before the bad version shipped (per
   Constitution Principle IV / EC-20's expand-then-contract discipline).
3. File an incident note and follow the post-incident amendment procedure in
   the constitution's Governance section if the incident reveals a gap in
   this runbook or the constitution itself.
