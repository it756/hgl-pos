-- Master data tables for the retail POS MVP.
-- RLS policies are installed in a later migration so this file stays focused on shape, constraints, and indexes.

create extension if not exists pgcrypto;

create table public.stores (
  store_id uuid primary key,
  code text not null unique,
  name text not null,
  region text,
  timezone text not null default 'Africa/Lusaka',
  offline_threshold_minutes_trading int not null default 240 check (offline_threshold_minutes_trading > 0),
  offline_threshold_minutes_overnight int not null default 1440 check (offline_threshold_minutes_overnight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tills (
  till_id uuid primary key,
  store_id uuid not null references public.stores(store_id),
  label text not null,
  device_identity text not null unique,
  device_credential_hash text not null,
  local_sequence_hwm bigint not null default 0 check (local_sequence_hwm >= 0),
  provisioned_at timestamptz,
  retired_at timestamptz,
  constraint tills_retired_after_provisioned check (
    retired_at is null or provisioned_at is null or retired_at >= provisioned_at
  ),
  constraint tills_store_label_unique unique (store_id, label)
);

create table public.sku_categories (
  category_id uuid primary key,
  code text not null unique,
  name text not null,
  parent_category_id uuid references public.sku_categories(category_id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skus (
  sku_id uuid primary key,
  code text not null unique,
  barcode text,
  name text not null,
  category_id uuid references public.sku_categories(category_id),
  unit_type text not null check (unit_type in ('quantity', 'weight')),
  track_batch boolean not null default false,
  track_expiry boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sku_barcodes (
  barcode text primary key,
  sku_id uuid not null references public.skus(sku_id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index sku_barcodes_one_primary_per_sku
  on public.sku_barcodes (sku_id)
  where is_primary;

create table public.store_sku_availability (
  store_id uuid not null references public.stores(store_id),
  sku_id uuid not null references public.skus(sku_id),
  reorder_point numeric(14, 3),
  is_stocked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, sku_id),
  constraint store_sku_availability_reorder_point_nonnegative check (
    reorder_point is null or reorder_point >= 0
  )
);

create table public.suppliers (
  supplier_id uuid primary key,
  code text not null unique,
  name text not null,
  contact_name text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sku_suppliers (
  sku_id uuid not null references public.skus(sku_id),
  supplier_id uuid not null references public.suppliers(supplier_id),
  supplier_sku_code text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (sku_id, supplier_id)
);

create unique index sku_suppliers_one_primary_per_sku
  on public.sku_suppliers (sku_id)
  where is_primary;

create table public.users (
  user_id uuid primary key,
  role text not null check (role in ('cashier', 'store_manager', 'hq_admin')),
  store_id uuid references public.stores(store_id),
  full_name text not null,
  pin_hash text not null,
  pin_updated_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_hq_admin_store_scope check (
    (role = 'hq_admin' and store_id is null) or (role <> 'hq_admin' and store_id is not null)
  )
);

create table public.promotions (
  promotion_id uuid primary key,
  type text not null check (type in ('date_range_discount', 'bogo', 'bundle', 'loyalty_tier')),
  payload jsonb not null,
  applies_to_sku_ids uuid[],
  store_id uuid references public.stores(store_id),
  effective_from timestamptz,
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_effective_range check (
    effective_to is null or effective_from is null or effective_to > effective_from
  )
);

create table public.price_versions (
  price_version_id uuid primary key,
  sku_id uuid not null references public.skus(sku_id),
  store_id uuid references public.stores(store_id),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  currency text not null default 'ZMW',
  effective_from timestamptz not null,
  created_by_user_id uuid not null references public.users(user_id),
  created_at timestamptz not null default now()
);

create index tills_store_id_idx on public.tills (store_id);
create index sku_categories_parent_category_id_idx on public.sku_categories (parent_category_id);
create index skus_category_id_idx on public.skus (category_id);
create index sku_barcodes_sku_id_idx on public.sku_barcodes (sku_id);
create index store_sku_availability_stocked_idx
  on public.store_sku_availability (store_id, sku_id)
  where is_stocked;
create index sku_suppliers_supplier_id_idx on public.sku_suppliers (supplier_id);
create index users_store_role_idx on public.users (store_id, role) where is_active;
create index promotions_store_active_window_idx
  on public.promotions (store_id, effective_from, effective_to)
  where is_active;
create index promotions_payload_gin_idx on public.promotions using gin (payload);
create index price_versions_active_lookup_idx
  on public.price_versions (sku_id, store_id, effective_from desc, created_at desc);
create index price_versions_global_lookup_idx
  on public.price_versions (sku_id, effective_from desc, created_at desc)
  where store_id is null;
