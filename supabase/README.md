# Supabase — local dev URLs contract

After `pnpm run supabase:start`:

| Service | URL / port |
| --- | --- |
| API (PostgREST) | http://127.0.0.1:54321 |
| Studio UI | http://127.0.0.1:54323 |
| Postgres (direct) | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Postgres (pooler, transaction mode) | postgresql://postgres:postgres@127.0.0.1:54329/postgres |
| Realtime | ws://127.0.0.1:54321/realtime/v1 |
| Storage | http://127.0.0.1:54321/storage/v1 |
| Inbucket (email test inbox) | http://127.0.0.1:54324 |
| Edge Functions inspector | http://127.0.0.1:8083 |

`$SUPABASE_DB_URL` used by scripts throughout the repo defaults to the pooler URL above unless overridden in `.env.local`.

Sanity check after `supabase start`:

```powershell
psql "$env:SUPABASE_DB_URL" -c "select count(*) from stores;"
```

Should return 0 rows until `pnpm run supabase:seed` is run.
