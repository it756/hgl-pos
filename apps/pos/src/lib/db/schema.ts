import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { SCHEMA_VERSION } from "@hgl/db-shared";

export const localSchemaVersion = SCHEMA_VERSION;

export const skus = sqliteTable(
  "skus",
  {
    skuId: text("sku_id").primaryKey(),
    code: text("code").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    categoryId: text("category_id"),
    unitType: text("unit_type", { enum: ["quantity", "weight"] }).notNull(),
    trackBatch: integer("track_batch", { mode: "boolean" }).notNull().default(false),
    trackExpiry: integer("track_expiry", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex("skus_code_idx").on(table.code),
    barcodeIdx: index("skus_barcode_idx").on(table.barcode),
    categoryIdx: index("skus_category_idx").on(table.categoryId),
  }),
);

export const skuBarcodes = sqliteTable(
  "sku_barcodes",
  {
    barcode: text("barcode").primaryKey(),
    skuId: text("sku_id").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    skuIdx: index("sku_barcodes_sku_idx").on(table.skuId),
  }),
);

export const skuCategories = sqliteTable(
  "sku_categories",
  {
    categoryId: text("category_id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentCategoryId: text("parent_category_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex("sku_categories_code_idx").on(table.code),
    parentIdx: index("sku_categories_parent_idx").on(table.parentCategoryId),
  }),
);

export const promotions = sqliteTable(
  "promotions",
  {
    promotionId: text("promotion_id").primaryKey(),
    type: text("type", { enum: ["date_range_discount", "bogo", "bundle", "loyalty_tier"] }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    appliesToSkuIds: text("applies_to_sku_ids", { mode: "json" }),
    storeId: text("store_id"),
    effectiveFrom: text("effective_from"),
    effectiveTo: text("effective_to"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    activeWindowIdx: index("promotions_active_window_idx").on(table.storeId, table.effectiveFrom, table.effectiveTo),
  }),
);

export const priceVersions = sqliteTable(
  "price_versions",
  {
    priceVersionId: text("price_version_id").primaryKey(),
    skuId: text("sku_id").notNull(),
    storeId: text("store_id"),
    unitPrice: real("unit_price").notNull(),
    currency: text("currency").notNull().default("ZMW"),
    effectiveFrom: text("effective_from").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    lookupIdx: index("price_versions_lookup_idx").on(table.skuId, table.storeId, table.effectiveFrom, table.createdAt),
  }),
);

export const currentStockByStoreSku = sqliteTable(
  "current_stock_by_store_sku",
  {
    storeId: text("store_id").notNull(),
    skuId: text("sku_id").notNull(),
    qtyOnHand: real("qty_on_hand").notNull().default(0),
    qtyInTransitOut: real("qty_in_transit_out").notNull().default(0),
    qtyInTransitIn: real("qty_in_transit_in").notNull().default(0),
    isOversold: integer("is_oversold", { mode: "boolean" }).notNull().default(false),
    lastEventServerTs: text("last_event_server_ts"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.storeId, table.skuId] }),
    oversoldIdx: index("current_stock_oversold_idx").on(table.storeId, table.skuId),
    lastEventIdx: index("current_stock_last_event_idx").on(table.storeId, table.lastEventServerTs),
  }),
);

export const stockEvents = sqliteTable(
  "stock_events",
  {
    eventId: text("event_id").primaryKey(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    clientTs: text("client_ts").notNull(),
    serverTs: text("server_ts").notNull(),
    appVersion: text("app_version").notNull(),
    schemaVer: integer("schema_ver").notNull(),
    skuId: text("sku_id").notNull(),
    eventType: text("event_type", {
      enum: ["sale", "refund", "transfer_out", "transfer_in", "transfer_variance", "adjustment", "count_correction"],
    }).notNull(),
    deltaQty: real("delta_qty").notNull(),
    sourceRefId: text("source_ref_id"),
    batchNo: text("batch_no"),
    expiryDate: text("expiry_date"),
    reasonCode: text("reason_code"),
    notes: text("notes"),
  },
  (table) => ({
    storeSkuTsIdx: index("stock_events_store_sku_ts_idx").on(table.storeId, table.skuId, table.serverTs),
    tillTsIdx: index("stock_events_till_ts_idx").on(table.tillId, table.serverTs),
    sourceRefIdx: index("stock_events_source_ref_idx").on(table.sourceRefId),
  }),
);

export const users = sqliteTable(
  "users",
  {
    userId: text("user_id").primaryKey(),
    role: text("role", { enum: ["cashier", "store_manager", "hq_admin"] }).notNull(),
    storeId: text("store_id"),
    fullName: text("full_name").notNull(),
    pinHash: text("pin_hash").notNull(),
    pinUpdatedAt: text("pin_updated_at").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    storeRoleIdx: index("users_store_role_idx").on(table.storeId, table.role),
  }),
);

export const saleEvents = sqliteTable(
  "sale_events",
  {
    eventId: text("event_id").primaryKey(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    clientTs: text("client_ts").notNull(),
    serverTs: text("server_ts").notNull(),
    appVersion: text("app_version").notNull(),
    schemaVer: integer("schema_ver").notNull(),
    saleId: text("sale_id").notNull(),
    cashierId: text("cashier_id").notNull(),
    shiftId: text("shift_id").notNull(),
    status: text("status", { enum: ["completed", "voided", "refunded"] }).notNull(),
    items: text("items", { mode: "json" }).notNull(),
    tenders: text("tenders", { mode: "json" }).notNull(),
    subtotal: real("subtotal").notNull(),
    discountTotal: real("discount_total").notNull().default(0),
    taxTotal: real("tax_total").notNull().default(0),
    grandTotal: real("grand_total").notNull(),
    originalSaleId: text("original_sale_id"),
    refundKind: text("refund_kind", { enum: ["same_till_session_void", "same_till_history", "cross_till"] }),
  },
  (table) => ({
    saleIdIdx: uniqueIndex("sale_events_sale_id_idx").on(table.saleId),
    tillTsIdx: index("sale_events_till_ts_idx").on(table.tillId, table.serverTs),
    cashierTsIdx: index("sale_events_cashier_ts_idx").on(table.cashierId, table.serverTs),
  }),
);

export const shiftEvents = sqliteTable(
  "shift_events",
  {
    eventId: text("event_id").primaryKey(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    clientTs: text("client_ts").notNull(),
    serverTs: text("server_ts").notNull(),
    appVersion: text("app_version").notNull(),
    schemaVer: integer("schema_ver").notNull(),
    shiftId: text("shift_id").notNull(),
    cashierId: text("cashier_id").notNull(),
    eventKind: text("event_kind", { enum: ["shift_open", "shift_close"] }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
  },
  (table) => ({
    oneKindPerShiftIdx: uniqueIndex("shift_events_one_kind_per_shift_idx").on(table.shiftId, table.eventKind),
    tillTsIdx: index("shift_events_till_ts_idx").on(table.tillId, table.serverTs),
  }),
);

export const sales = sqliteTable(
  "sales",
  {
    saleId: text("sale_id").primaryKey(),
    eventId: text("event_id").notNull(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    cashierId: text("cashier_id").notNull(),
    shiftId: text("shift_id").notNull(),
    clientTs: text("client_ts").notNull(),
    serverTs: text("server_ts").notNull(),
    appVersion: text("app_version").notNull(),
    schemaVer: integer("schema_ver").notNull(),
    status: text("status", { enum: ["completed", "voided", "refunded"] }).notNull(),
    latestStatus: text("latest_status", { enum: ["completed", "voided", "refunded"] }).notNull(),
    subtotal: real("subtotal").notNull(),
    discountTotal: real("discount_total").notNull().default(0),
    taxTotal: real("tax_total").notNull().default(0),
    grandTotal: real("grand_total").notNull(),
    originalSaleId: text("original_sale_id"),
    refundKind: text("refund_kind", { enum: ["same_till_session_void", "same_till_history", "cross_till"] }),
  },
  (table) => ({
    eventIdx: uniqueIndex("sales_event_idx").on(table.eventId),
    tillTsIdx: index("sales_till_ts_idx").on(table.tillId, table.serverTs),
    shiftIdx: index("sales_shift_idx").on(table.storeId, table.shiftId),
  }),
);

export const shifts = sqliteTable(
  "shifts",
  {
    shiftId: text("shift_id").primaryKey(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    cashierId: text("cashier_id").notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    openingFloat: real("opening_float").notNull(),
    cashCounted: real("cash_counted"),
    systemCash: real("system_cash").notNull().default(0),
    overShort: real("over_short").notNull().default(0),
    status: text("status", { enum: ["open", "closed"] }).notNull(),
  },
  (table) => ({
    tillOpenedIdx: index("shifts_till_opened_idx").on(table.tillId, table.openedAt),
    cashierOpenedIdx: index("shifts_cashier_opened_idx").on(table.cashierId, table.openedAt),
  }),
);

export const syncHealthLocal = sqliteTable(
  "sync_health_local",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    tillId: text("till_id").notNull(),
    storeId: text("store_id").notNull(),
    clientTs: text("client_ts").notNull(),
    queueDepth: integer("queue_depth").notNull().default(0),
    oldestPendingEventAt: text("oldest_pending_event_at"),
    lastSuccessfulSyncAt: text("last_successful_sync_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    appVersion: text("app_version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => ({
    tillClientTsIdx: index("sync_health_local_till_client_ts_idx").on(table.tillId, table.clientTs),
    unsentIdx: index("sync_health_local_unsent_idx").on(table.sentAt),
  }),
);

export const localUploadQueue = sqliteTable(
  "local_upload_queue",
  {
    queueId: text("queue_id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventKind: text("event_kind").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status", { enum: ["pending", "uploading", "failed", "uploaded"] }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lockedAt: text("locked_at"),
    uploadedAt: text("uploaded_at"),
    lastError: text("last_error"),
  },
  (table) => ({
    eventIdx: uniqueIndex("local_upload_queue_event_idx").on(table.eventId),
    pendingIdx: index("local_upload_queue_pending_idx").on(table.status, table.nextAttemptAt, table.createdAt),
  }),
);

export const localClockState = sqliteTable("local_clock_state", {
  key: text("key").primaryKey(),
  networkTimeAtSync: text("network_time_at_sync").notNull(),
  localTimeAtSync: text("local_time_at_sync").notNull(),
  offsetMs: integer("offset_ms").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const localDeviceCredential = sqliteTable("local_device_credential", {
  tillId: text("till_id").primaryKey(),
  credential: text("credential").notNull(),
  expiresAt: text("expires_at").notNull(),
  rotatedAt: text("rotated_at").notNull(),
});

export const posSqliteSchema = {
  currentStockByStoreSku,
  localClockState,
  localDeviceCredential,
  localUploadQueue,
  priceVersions,
  promotions,
  saleEvents,
  sales,
  shiftEvents,
  shifts,
  skuBarcodes,
  skuCategories,
  skus,
  stockEvents,
  syncHealthLocal,
  users,
};
