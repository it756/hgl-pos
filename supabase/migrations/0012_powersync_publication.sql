-- Enroll all PowerSync source tables in the logical replication publication.
-- PowerSync self-hosted validates stream queries against this publication.

do $$
declare
  table_name text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'powersync'
  ) then
    create publication powersync;
  end if;

  foreach table_name in array array[
    'skus',
    'sku_barcodes',
    'sku_categories',
    'promotions',
    'price_versions',
    'current_stock_by_store_sku',
    'stock_events',
    'users',
    'sale_events',
    'shift_events',
    'sales',
    'shifts',
    'transfers',
    'transfer_events',
    'adjustment_events',
    'sync_health_snapshots',
    'sync_health_alerts',
    'tills',
    'store_sku_availability'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'powersync'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication powersync add table public.%I', table_name);
    end if;
  end loop;
end $$;
