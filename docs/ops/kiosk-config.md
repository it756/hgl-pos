# Kiosk Configuration (Windows Assigned Access / Shell Launcher)

Constitution's Additional Constraints mandate **Windows Assigned Access /
Shell Launcher** for kiosk lockdown — the terminal is locked to the POS app;
cashiers must never be able to reach the Windows desktop, taskbar, or
another application.

## Choosing between Assigned Access and Shell Launcher

- **Assigned Access** (`Settings > Accounts > Other users > Set up a kiosk`,
  or the `WESL_UserSetting`/MDM `AssignedAccessConfiguration` CSP): simplest
  option, restricts a single local/Azure AD account to one app. Preferred for
  standard Windows 11 Pro/Enterprise tills.
- **Shell Launcher** (Windows 10/11 IoT Enterprise only, via the
  `Microsoft-Windows-Shell-Launcher` optional component): replaces
  `explorer.exe` entirely with the POS app as the literal shell. Required if
  the terminal SKU is IoT Enterprise (per the constitution's terminal-SKU
  note) and Assigned Access isn't available/sufficient.

Confirm which Windows SKU each pilot/fleet till actually ships with before
picking one — do not assume; the constitution notes the final SKU is "tied
to Intune-enrolment support and OPOS/UPOS driver availability" and may not
be finalised until hardware procurement completes.

## Configuration template (Shell Launcher, IoT Enterprise)

1. Enable the Shell Launcher optional feature:
   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName Client-EmbeddedShellLauncher
   ```
2. Configure the shell launcher policy (via Intune custom OMA-URI profile or
   local `Set-CimInstance`) to point at the installed POS executable path
   (the Tauri-built `.exe`, not a browser/URL — this is a native shell app,
   not a kiosk browser).
3. Configure the **default action on shell exit** to `RestartShell` (if the
   POS app crashes or is closed, it must relaunch automatically, never drop
   to a desktop).
4. Disable Ctrl+Alt+Del task manager access and the on-screen keyboard's
   ability to switch apps, per Shell Launcher's standard kiosk hardening
   guidance.

## Configuration template (Assigned Access, Windows 11 Pro/Enterprise)

1. Create a dedicated local or Azure AD kiosk account per till (never a
   shared admin account).
2. Assign the POS app as that account's kiosk app via
   `Settings > Accounts > Family & other users > Set up a kiosk`, or the
   equivalent Intune `AssignedAccessConfiguration` CSP for fleet-wide
   deployment (see `docs/ops/intune-deployment.md`).
3. Confirm the kiosk account auto-logs-in on boot (so a power cycle doesn't
   strand the till at a login screen with no cashier present to sign in).

## Verification checklist before a till ships to a store

- [ ] Ctrl+Alt+Del, Alt+Tab, Windows key, and any virtual-desktop switch are
      all inert.
- [ ] The POS app auto-launches on boot with no manual login step.
- [ ] Closing/crashing the POS app relaunches it automatically, never drops
      to a desktop or another app.
- [ ] USB peripherals (scanner, printer, cash drawer, card reader) are
      still fully functional under the locked-down shell.
- [ ] The kiosk configuration itself is deployed and verified via Intune
      (not applied by hand per-device) so it survives a re-image.
