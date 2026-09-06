# Phase-Transition Constitution Re-Affirmation Checklist

Per the constitution's Compliance Review section: *"The constitution MUST be
re-read and re-affirmed at the start of every phase transition in the
rollout plan (Phase 0 → 1 → 2 → 3 → 4 → 5); a transition MUST NOT proceed
without that affirmation being recorded."*

This checklist is that recorded affirmation. Copy this template into the
transition record for each phase boundary and fill it in — do not skip
sections because "nothing changed"; explicitly note "no change" instead.

## Transition: Phase ___ → Phase ___

**Date**: ____ **Reviewed by**: ____ **Constitution version reviewed against**: ____ (must match `.specify/memory/constitution.md`'s current `Version` line)

### Principle-by-principle re-affirmation

- [ ] **I. Offline-First At The Till** — no new critical-path code was added
      that performs a synchronous network call during sale/refund/void/
      shift-close. If a new till-side feature landed this phase, name it and
      confirm its offline behaviour explicitly.
- [ ] **II. Event-Sourced Additive Stock** — any new stock-affecting action
      added this phase writes an append-only `stock_events` row with a
      signed `delta_qty`, not a mutable current-stock update.
- [ ] **III. Independent Per-Till Sync** — no local coordinator/hub/broker
      was introduced; any new sync-rule bucket was isolation-tested
      (`powersync/tests/isolation.spec.ts`) before this transition.
- [ ] **IV. Idempotent, Backward-Compatible Sync Contract** — any new
      migration was checked by
      `packages/db-shared/scripts/check-migration-compat.ts` (`pnpm exec tsx
      scripts/check-migration-compat.ts` from `packages/db-shared/`) and
      reports clean, or every flagged drop carries a documented
      `EXPAND-CONTRACT-OK:` deprecation-window justification.
- [ ] **V. Auditable, Immutable Financial & Price Records** — any new
      price-change, stock-adjustment, refund, or role-change action calls
      `public.append_audit(...)` (directly or via a trigger) — see
      `supabase/tests/audit_completeness.spec.sql` for the automated check.
- [ ] **VI. Staged Rollout, Canary Deploys, Reversible Migrations** — this
      phase's changes are ready to land in the pilot store first per
      `docs/ops/canary.md`; no fleet-wide simultaneous deploy is planned.
- [ ] **VII. Security, RBAC & Regulatory Compliance By Default** — any new
      user-facing action resolves against an explicit role server-side (RLS
      or an explicit role check in a `SECURITY DEFINER` function), not only
      client-side gating.

### Sign-off

- [ ] All boxes above are checked, or every unchecked box has a linked
      justification (Complexity Tracking entry in `plan.md`, or a noted
      constitutional amendment in progress).
- [ ] If this transition reveals a gap the constitution was silent on, a
      proposed amendment has been filed (per the Governance section's
      post-incident rule) — this transition is NOT blocked on the amendment
      landing, but the amendment MUST be filed within one working week.

**Affirmation recorded by**: ____________________ **Date**: ____________
