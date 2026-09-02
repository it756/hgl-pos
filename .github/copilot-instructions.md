# hgl-pos Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-09-02

## Active Technologies
- TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed), Rust stable (Tauri shell build) + Next.js 15 (App Router), React 19, **Tauri 2 shell + PowerSync Tauri SDK (alpha) + tauri-plugin-updater; WebView2 runtime on Windows**, Supabase JS client v2, Zod (runtime validation of event payloads), Drizzle ORM for local SQLite typing and Postgres migrations, shadcn/ui + Tailwind for admin UI, TanStack Table for reports (001-retail-pos-mvp)
- Postgres 15 on Supabase (source of truth, logical replication enabled for PowerSync); SQLite (WAL mode) per till via PowerSync Tauri SDK (native filesystem, persists across app updates); Supabase Storage for report PDF exports (001-retail-pos-mvp)

- TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed) + Next.js 15 (App Router), React 19, PowerSync JS SDK + PowerSync Android runtime, Supabase JS client v2, Capacitor 6 (Android wrapper — see [research.md](research.md) §1), Zod (runtime validation of event payloads), Drizzle ORM for local SQLite typing and Postgres migrations, shadcn/ui + Tailwind for admin UI, TanStack Table for reports (001-retail-pos-mvp)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test; npm run lint

## Code Style

TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed): Follow standard conventions

## Recent Changes
- 001-retail-pos-mvp: Added TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed), Rust stable (Tauri shell build) + Next.js 15 (App Router), React 19, **Tauri 2 shell + PowerSync Tauri SDK (alpha) + tauri-plugin-updater; WebView2 runtime on Windows**, Supabase JS client v2, Zod (runtime validation of event payloads), Drizzle ORM for local SQLite typing and Postgres migrations, shadcn/ui + Tailwind for admin UI, TanStack Table for reports

- 001-retail-pos-mvp: Added TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed) + Next.js 15 (App Router), React 19, PowerSync JS SDK + PowerSync Android runtime, Supabase JS client v2, Capacitor 6 (Android wrapper — see [research.md](research.md) §1), Zod (runtime validation of event payloads), Drizzle ORM for local SQLite typing and Postgres migrations, shadcn/ui + Tailwind for admin UI, TanStack Table for reports

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
