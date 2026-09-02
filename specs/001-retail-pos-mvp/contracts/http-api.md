# HTTP API Contracts — Retail POS 001-retail-pos-mvp

The bulk of till ↔ backend traffic is not HTTP — it is PowerSync's own upload
protocol driven by the sync-rules in [powersync-sync-rules.yaml](powersync-sync-rules.yaml).
This file documents the small number of HTTP endpoints the system exposes on
top of PowerSync/Supabase.

All endpoints are Supabase Edge Functions unless noted. All expect a Supabase
Auth JWT in the `Authorization: Bearer <token>` header. Responses are JSON.

## Auth

### Access-token hook (Postgres function called by Supabase Auth)

Not an HTTP endpoint per se — it is a Supabase Auth "access token hook" that
injects the domain claims (`role`, `store_id`, `till_id`, `device_id`) into
every access token, based on the caller's `users` row.

Signature: `public.access_token_hook(event jsonb) returns jsonb`. Registered
via Supabase Auth configuration. Returns the incoming `event.claims` merged
with the domain claims.

### `POST /auth/device-credential/rotate`

Rotates the device-level PowerSync credential for a till. Called by the till
opportunistically on reconnect if the current credential is older than the
policy allows.

Request:

```json
{ "till_id": "<uuid>", "current_credential": "<opaque>" }
```

Response:

```json
{ "credential": "<opaque>", "expires_at": "<iso8601>" }
```

Auth: JWT with `role=device`, `till_id=<matching>`. RLS check on `tills` also
gates this. Success writes an entry to `audit_log`.

## Till provisioning

### `POST /provision-till`

One-shot provisioning of a new till. Used at initial setup only. Required by
FR-039 (fresh till onboarding requires connectivity).

Request:

```json
{
  "store_id": "<uuid>",
  "label": "Till 3",
  "device_identity": "<windows device identity — SMBIOS UUID or Intune-assigned device ID>",
  "operator_user_id": "<uuid>"
}
```

Response:

```json
{
  "till_id": "<uuid>",
  "credential": "<opaque>",
  "expires_at": "<iso8601>",
  "initial_sync_ready": true
}
```

Auth: JWT with `role=store_manager` for the target `store_id`, or
`role=hq_admin`.

Behaviour:

1. Insert `tills` row.
2. Mint device credential via `pgcrypto` + store salted hash in
   `tills.device_credential_hash`.
3. Write `audit_log` entry `action=till.provision`.
4. Return credential once; server never stores plaintext after this point.

## Cross-till refund verification

### `POST /verify-refund`

Server-side confirmation that an original sale exists, required by FR-012 /
User Story 5 before a cross-till or cross-day refund can be issued.

Request:

```json
{
  "original_sale_id": "<uuid>",
  "refund_reason": "<string>"
}
```

Response (200):

```json
{
  "eligible": true,
  "original": {
    "sale_id": "<uuid>",
    "till_id": "<uuid>",
    "store_id": "<uuid>",
    "grand_total": 128.5,
    "server_ts": "<iso8601>",
    "already_refunded": false
  }
}
```

Response (200, ineligible):

```json
{
  "eligible": false,
  "reason": "already_refunded" | "sale_not_found" | "outside_refund_window"
}
```

Auth: JWT with `role=cashier`, matching the requesting till. The refund
`sale_events` row itself is still written by the till through the normal
PowerSync upload path — this endpoint only _authorises_ it. The till stamps
the endpoint's `refund_token` (in the response, omitted above for brevity)
into the refund event's payload for auditability.

## Sync-health alerting

### `POST /internal/sync-health-check` (called by pg_cron only)

Not a public endpoint. Runs every minute. Scans `sync_health_snapshots` for
stale tills and inserts into `sync_health_alerts`. Posts to the configured
webhook (WhatsApp/SMS) when an alert opens or closes.

Auth: Supabase service role.

## Reporting

### `POST /report-export`

Server-side render of a report to CSV or PDF and drop into Supabase Storage.
Called from the admin app for large reports.

Request:

```json
{
  "report": "sales_by_store" | "sales_by_cashier" | "sales_by_sku" |
            "inventory_on_hand" | "transfer_history" | "till_reconciliation",
  "params": { "from": "<iso8601>", "to": "<iso8601>", "store_id": "<uuid?>" },
  "format": "csv" | "pdf"
}
```

Response:

```json
{
  "job_id": "<uuid>",
  "status": "queued",
  "poll_url": "/report-export/status/<job_id>"
}
```

For small reports the admin app streams the query directly and skips this
endpoint. Threshold to be tuned during Phase 4.

Auth: JWT with `role=hq_admin` or `role=store_manager` (params scoped to
their `store_id`).

## Errors

All endpoints return errors as:

```json
{ "error": { "code": "<snake_case>", "message": "<human readable>" } }
```

with the appropriate HTTP status (400 validation, 401 auth, 403 RLS/permission,
404 not found, 409 idempotency conflict, 500 server, 503 backend unavailable).

## Idempotency for HTTP writes

Any HTTP endpoint that writes should accept an `Idempotency-Key: <uuid>`
header. Server keeps the (key, response) pair for 24 h and replays the exact
response on retry. Applies to `provision-till`, `verify-refund`, and
`device-credential/rotate`. Not applied to `report-export` (naturally
idempotent-safe by nature of read-only underlying data).

## What is deliberately NOT an HTTP endpoint

- **Recording a sale, shift, or stock event.** All of these go through the
  PowerSync upload queue and land in the append-only event tables directly.
  There is no `POST /sale` endpoint by design — that would create a code path
  that could block a checkout on a network call, violating Principle I.
- **Reading catalog, prices, or stock at the till.** These come exclusively
  through the sync buckets. The till never issues a `GET /skus` HTTP call.
