import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PosRole = "cashier" | "store_manager" | "device";
type ScopeClaims = Record<string, string | null>;
type StreamBlocks = Record<string, string>;

const configPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "sync-config.yaml");
const syncConfig = readFileSync(configPath, "utf8");
const streamBlocks = parseStreamBlocks(syncConfig);

function parseStreamBlocks(configText: string): StreamBlocks {
  const normalizedConfigText = configText.replace(/\r\n/g, "\n");
  const matches = normalizedConfigText.matchAll(/\n {2}([a-z_]+):\n([\s\S]*?)(?=\n {2}[a-z_]+:\n|$)/g);
  const blocks: StreamBlocks = {};

  for (const match of matches) {
    const streamName = match[1];
    if (streamName === undefined) {
      throw new Error("Malformed PowerSync stream block");
    }

    blocks[streamName] = match[2] ?? "";
  }

  return blocks;
}

function streamQueries(streamName: string): string[] {
  const block = streamBlocks[streamName];
  if (block === undefined) {
    throw new Error(`Unknown PowerSync stream: ${streamName}`);
  }

  return block
    .split("\n")
    .map((line) => line.trim().replace(/^- /, "").replace(/^query: /, ""))
    .filter((line) => line.startsWith("SELECT "));
}

function streamAuthParameters(streamName: string): string[] {
  const block = streamBlocks[streamName];
  if (block === undefined) {
    throw new Error(`Unknown PowerSync stream: ${streamName}`);
  }

  return Array.from(block.matchAll(/auth\.parameter\('([^']+)'\)/g), ([, parameter]) => {
    if (parameter === undefined) {
      throw new Error(`Malformed auth parameter in stream: ${streamName}`);
    }

    return parameter;
  });
}

function activeStreams(claims: ScopeClaims): string[] {
  return Object.keys(streamBlocks).filter((streamName) => {
    const parameters = streamAuthParameters(streamName);
    return parameters.length > 0 && parameters.every((parameter) => claims[parameter] !== null);
  });
}

function claimsFor(role: PosRole, storeId: string, tillId: string): ScopeClaims {
  return {
    store_catalog_store_id: role === "cashier" || role === "store_manager" || role === "device" ? storeId : null,
    store_prices_store_id: role === "cashier" || role === "store_manager" || role === "device" ? storeId : null,
    store_stock_store_id: role === "cashier" || role === "store_manager" || role === "device" ? storeId : null,
    store_users_store_id: storeId,
    till_activity_till_id: role === "cashier" ? tillId : null,
    store_operations_store_id: role === "store_manager" ? storeId : null,
    sync_health_store_id: role === "store_manager" ? storeId : null,
    device_provisioning_till_id: role === "device" ? tillId : null,
  };
}

function queriesFor(streamNames: string[]): string[] {
  return streamNames.flatMap((streamName) => streamQueries(streamName));
}

describe("PowerSync Sync Streams isolation", () => {
  const storeA = "store-a";
  const tillA1 = "till-a-1";

  it("keeps cashier subscriptions scoped to their store and till", () => {
    const streams = activeStreams(claimsFor("cashier", storeA, tillA1));

    expect(streams.sort()).toEqual([
      "store_catalog",
      "store_prices",
      "store_stock",
      "store_users",
      "till_own_activity",
    ].sort());

    for (const query of streamQueries("store_catalog")) {
      expect(query).toContain("auth.parameter('store_catalog_store_id')");
    }
    expect(streamQueries("store_prices")).toEqual([
      "SELECT price_versions.* FROM price_versions WHERE price_versions.store_id = auth.parameter('store_prices_store_id')",
      "SELECT price_versions.* FROM price_versions JOIN store_sku_availability ON store_sku_availability.sku_id = price_versions.sku_id WHERE store_sku_availability.store_id = auth.parameter('store_prices_store_id') AND price_versions.store_id IS NULL",
    ]);
    for (const query of streamQueries("store_stock")) {
      expect(query).toContain("auth.parameter('store_stock_store_id')");
    }
    expect(streamQueries("store_users")[0]).toContain("users.store_id = auth.parameter('store_users_store_id')");
  });

  it("does not expose neighboring till activity to cashier subscriptions", () => {
    expect(streamQueries("till_own_activity")).toEqual([
      "SELECT sale_events.* FROM sale_events WHERE sale_events.till_id = auth.parameter('till_activity_till_id')",
      "SELECT shift_events.* FROM shift_events WHERE shift_events.till_id = auth.parameter('till_activity_till_id')",
      "SELECT sales.* FROM sales WHERE sales.till_id = auth.parameter('till_activity_till_id')",
      "SELECT shifts.* FROM shifts WHERE shifts.till_id = auth.parameter('till_activity_till_id')",
    ]);
  });

  it("lets device credentials see their store's catalog/prices/stock, roster, and till provisioning", () => {
    const streams = activeStreams(claimsFor("device", storeA, tillA1));
    const queries = queriesFor(streams).join("\n");

    expect(streams.sort()).toEqual(
      ["device_provisioning", "store_catalog", "store_prices", "store_stock", "store_users"].sort(),
    );
    expect(queries).toContain("FROM users");
    expect(queries).toContain("FROM tills");
    expect(queries).toMatch(/FROM (skus|sku_barcodes|sku_categories|promotions|price_versions|current_stock_by_store_sku|stock_events)\b/);
    // Device never gets till-activity, store-operations, or sync-health —
    // those stay cashier/store_manager-only.
    expect(queries).not.toMatch(/FROM (sale_events|shift_events|sales|shifts|transfers|transfer_events|adjustment_events|sync_health_snapshots|sync_health_alerts)\b/);
  });

  it("keeps store manager operations and sync health scoped to their store", () => {
    const streams = activeStreams(claimsFor("store_manager", storeA, tillA1));

    expect(streams.sort()).toEqual([
      "store_catalog",
      "store_operations",
      "store_prices",
      "store_stock",
      "store_users",
      "sync_health_store",
    ].sort());
    expect(streamQueries("store_operations")).toEqual([
      "SELECT transfers.* FROM transfers WHERE transfers.source_store_id = auth.parameter('store_operations_store_id')",
      "SELECT transfers.* FROM transfers WHERE transfers.destination_store_id = auth.parameter('store_operations_store_id')",
      "SELECT transfer_events.* FROM transfer_events WHERE transfer_events.source_store_id = auth.parameter('store_operations_store_id')",
      "SELECT transfer_events.* FROM transfer_events WHERE transfer_events.destination_store_id = auth.parameter('store_operations_store_id')",
      "SELECT adjustment_events.* FROM adjustment_events WHERE adjustment_events.store_id = auth.parameter('store_operations_store_id')",
      "SELECT sales.* FROM sales WHERE sales.store_id = auth.parameter('store_operations_store_id')",
      "SELECT shifts.* FROM shifts WHERE shifts.store_id = auth.parameter('store_operations_store_id')",
    ]);
    for (const query of streamQueries("sync_health_store")) {
      expect(query).toContain("auth.parameter('sync_health_store_id')");
    }
  });

  it("does not use legacy request JWT role gates in active Sync Streams", () => {
    expect(syncConfig).not.toContain("request.jwt()");
    expect(syncConfig).not.toContain("auth.parameter('pos_role')");
    expect(syncConfig).not.toMatch(/\bIN \('cashier'/);
  });
});
