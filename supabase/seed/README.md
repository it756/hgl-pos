# Local Seed Credentials

Development-only credentials for the local Supabase seed.

## Admin and Manager Sign-In

All seeded email users use password `local-dev-password`.

| Role | Email |
| --- | --- |
| HQ admin | `hq.admin@hgl.local` |
| Store manager | `store.manager@hgl.local` |
| Cashier 1 | `cashier.one@hgl.local` |
| Cashier 2 | `cashier.two@hgl.local` |

## POS Offline PINs

| Cashier | PIN | Default till |
| --- | --- | --- |
| Cashier One | `1234` | Till 1 |
| Cashier Two | `5678` | Till 2 |

Seeded PIN hashes are Argon2id PHC strings compatible with the Tauri shell PIN verifier.
