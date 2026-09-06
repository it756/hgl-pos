import { ShiftEventSchema, type ShiftEvent } from "@hgl/events";

// Zod-validated shift_open / shift_close event builders (T057). Pure
// functions — no DB/IO. Callers (events/queue.ts) supply the event_id
// (id.ts), client_ts (time/clock.ts's trusted clock), and app metadata.

export type BuildShiftEventBase = {
  eventId: string;
  tillId: string;
  storeId: string;
  clientTs: string;
  appVersion: string;
  schemaVer: number;
  shiftId: string;
  cashierId: string;
};

export type BuildShiftOpenEventParams = BuildShiftEventBase & {
  openingFloat: number;
};

export function buildShiftOpenEvent(params: BuildShiftOpenEventParams): ShiftEvent {
  return ShiftEventSchema.parse({
    event_id: params.eventId,
    till_id: params.tillId,
    store_id: params.storeId,
    client_ts: params.clientTs,
    app_version: params.appVersion,
    schema_ver: params.schemaVer,
    kind: "shift",
    shift_id: params.shiftId,
    cashier_id: params.cashierId,
    event_kind: "shift_open",
    payload: {
      opening_float: params.openingFloat,
    },
  });
}

export type BuildShiftCloseEventParams = BuildShiftEventBase & {
  cashCounted: number;
  tenderBreakdown: Record<string, number>;
  notes: string | null;
};

export function buildShiftCloseEvent(params: BuildShiftCloseEventParams): ShiftEvent {
  return ShiftEventSchema.parse({
    event_id: params.eventId,
    till_id: params.tillId,
    store_id: params.storeId,
    client_ts: params.clientTs,
    app_version: params.appVersion,
    schema_ver: params.schemaVer,
    kind: "shift",
    shift_id: params.shiftId,
    cashier_id: params.cashierId,
    event_kind: "shift_close",
    payload: {
      cash_counted: params.cashCounted,
      tender_breakdown: params.tenderBreakdown,
      notes: params.notes,
    },
  });
}
