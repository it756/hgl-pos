"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  Tag,
  Percent,
  History,
  Package,
  PackageSearch,
  ArrowLeftRight,
  Truck,
  Warehouse,
  FileBarChart,
  ShieldCheck,
  Settings,
  Users,
  Rocket,
  Store,
  MonitorSmartphone,
  ClipboardList,
  SlidersHorizontal,
  Receipt,
  Clock,
  Contact,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { PosRole } from "../lib/supabase/claims";

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: readonly PosRole[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const HQ = ["hq_admin"] as const;
const STAFF = ["hq_admin", "store_manager"] as const;

// Each item's `roles` mirrors the requireRole() gate on its page, so a user
// never sees a link that would just bounce them back to the dashboard.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard, roles: STAFF },
      { label: "Sync Health", href: "/sync-health", icon: Activity, roles: STAFF },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Sales", href: "/sales", icon: Receipt, roles: STAFF },
      { label: "Shifts", href: "/shifts", icon: Clock, roles: STAFF },
      { label: "Customers", href: "/customers", icon: Contact, roles: STAFF },
    ],
  },
  {
    label: "Catalog",
    items: [
      { label: "Products", href: "/catalog", icon: PackageSearch, roles: STAFF },
      { label: "Prices", href: "/prices", icon: Tag, roles: HQ },
      { label: "Promotions", href: "/promotions", icon: Percent, roles: HQ },
      { label: "Price Audit", href: "/audit/prices", icon: History, roles: STAFF },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Inventory", href: "/inventory", icon: Package, roles: STAFF },
      { label: "Stock Counts", href: "/counts", icon: ClipboardList, roles: STAFF },
      { label: "Adjustments", href: "/adjustments", icon: SlidersHorizontal, roles: STAFF },
      { label: "Transfers", href: "/transfers", icon: ArrowLeftRight, roles: STAFF },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: STAFF },
      { label: "Suppliers", href: "/suppliers", icon: Truck, roles: STAFF },
    ],
  },
  {
    label: "Reporting",
    items: [
      { label: "Reports", href: "/reports", icon: FileBarChart, roles: STAFF },
      { label: "Audit Log", href: "/audit", icon: ShieldCheck, roles: STAFF },
      { label: "Rollout", href: "/rollout", icon: Rocket, roles: STAFF },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Stores", href: "/stores", icon: Store, roles: HQ },
      { label: "Tills", href: "/tills", icon: MonitorSmartphone, roles: STAFF },
      { label: "Users", href: "/users", icon: Users, roles: STAFF },
      { label: "Settings", href: "/settings", icon: Settings, roles: HQ },
    ],
  },
];

const ALL_HREFS = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

// Longest matching prefix wins, so /audit/prices highlights "Price Audit"
// rather than "Audit Log", and /catalog/<id> still highlights "Products".
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

export function visibleNavGroups(role: PosRole | null): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => role !== null && item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

export function AppSidebar({ role }: { role: PosRole | null }) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  return (
    <nav className="fixed left-0 top-0 z-50 flex h-screen w-sidebar-width flex-col gap-xs border-r border-surface-container-high bg-surface-container-lowest p-sm shadow-sm">
      <div className="mb-xs flex items-center gap-sm px-sm py-md">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary font-bold text-primary-foreground">
          H
        </div>
        <div>
          <h1 className="text-headline-md font-headline-md font-bold text-on-surface">Harvest POS</h1>
          <p className="text-label-caps font-label-caps text-on-surface-variant opacity-70">Supermarket Ops</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {visibleNavGroups(role).map((group) => (
          <div key={group.label}>
            <span className="block px-sm pb-1 pt-3 text-label-caps font-label-caps text-on-surface-variant/70 uppercase">
              {group.label}
            </span>
            {group.items.map((item) => {
              const isActive = current === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className={cn(
                    "flex items-center gap-sm rounded-lg px-sm py-2 text-body-md font-body-md transition-colors",
                    isActive
                      ? "bg-primary-container font-semibold text-on-primary-container"
                      : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
