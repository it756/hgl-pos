"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Schema } from "@powersync/common";
import { appDataDir } from "@tauri-apps/api/path";
import type { IDb } from "./interface";
import { SidecarDb } from "./sidecar";
import { TauriSdkDb } from "./tauri-sdk";

// Empty until the backend connector (.connect()) is wired — domain tables are
// currently read/written via raw SQL through IDb, not PowerSync's typed views.
const posSyncSchema = new Schema({});

const DbContext = createContext<IDb | null>(null);

export type DbProviderProps = {
  children: ReactNode;
  sidecarEndpoint?: string;
};

export function DbProvider({ children, sidecarEndpoint }: DbProviderProps) {
  const [db, setDb] = useState<IDb | null>(null);
  const [initError, setInitError] = useState<Error | null>(null);

  useEffect(() => {
    // Constructing/initializing the DB must stay inside this client-only
    // effect: it never runs during SSR/static-export prerendering, where no
    // Tauri IPC or sidecar backend is reachable.
    let cancelled = false;
    let instance: IDb;

    try {
      instance = createDb(sidecarEndpoint);
    } catch (err) {
      setInitError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    instance
      .init()
      .then(() => {
        if (!cancelled) setDb(instance);
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      void instance.close();
    };
  }, [sidecarEndpoint]);

  if (initError !== null) {
    // Surfaced by the nearest error boundary (apps/pos/src/app/error.tsx / global-error.tsx).
    throw initError;
  }

  if (db === null) {
    return <DbStartingScreen />;
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): IDb {
  const db = useContext(DbContext);
  if (db === null) {
    throw new Error("useDb() must be called within a DbProvider");
  }
  return db;
}

function createDb(sidecarEndpoint?: string): IDb {
  if (isTauriRuntime()) {
    return new TauriSdkDb({ schema: posSyncSchema, dbLocationAsync: appDataDir });
  }

  if (sidecarEndpoint !== undefined && sidecarEndpoint !== "") {
    return new SidecarDb({ endpoint: sidecarEndpoint });
  }

  throw new Error(
    "No PowerSync backend available: not running inside Tauri and no sidecar endpoint configured (NEXT_PUBLIC_POWERSYNC_SIDECAR_URL).",
  );
}

type TauriGlobal = typeof globalThis & { __TAURI_INTERNALS__?: { invoke?: unknown } };

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (globalThis as TauriGlobal).__TAURI_INTERNALS__?.invoke === "function";
}

function DbStartingScreen() {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "system-ui" }}>
      <p>Starting till database…</p>
    </div>
  );
}
