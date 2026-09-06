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
  ArrowLeftRight,
  Truck,
  Warehouse,
  FileBarChart,
  ShieldCheck,
  Settings,
  Users,
  Rocket,
} from "lucide-react";
import { cn } from "../lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

// Pruned to routes that exist or are planned in tasks.md — the Stitch mockups
// include several nav items (Order Queue, Revenue Desk, Tax Engine,
// Marketplace, Register) with no corresponding feature in this product.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Sync Health", href: "/sync-health", icon: Activity },
    ],
  },
  {
    label: "Catalog",
    items: [
      { label: "Prices", href: "/prices", icon: Tag },
      { label: "Promotions", href: "/promotions", icon: Percent },
      { label: "Price Audit", href: "/audit/prices", icon: History },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Inventory", href: "/inventory", icon: Package },
      { label: "Transfers", href: "/transfers", icon: ArrowLeftRight },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse },
      { label: "Suppliers", href: "/suppliers", icon: Truck },
    ],
  },
  {
    label: "Reporting",
    items: [
      { label: "Reports", href: "/reports", icon: FileBarChart },
      { label: "Audit Log", href: "/audit", icon: ShieldCheck },
      { label: "Rollout", href: "/rollout", icon: Rocket },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Users", href: "/users", icon: Users },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

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
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <span className="block px-sm pb-1 pt-3 text-label-caps font-label-caps text-on-surface-variant/70 uppercase">
              {group.label}
            </span>
            {group.items.map((item) => {
              const isActive = pathname === item.href;
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
