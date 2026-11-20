import Link from "next/link";
import type { Route } from "next";
import { cn } from "../lib/utils";

export type TabItem = { key: string; label: string; href: string };

export function TabNav({ tabs, active }: { tabs: TabItem[]; active: string }) {
  return (
    <nav aria-label="Sections" className="flex gap-1 border-b border-surface-container-high">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href as Route}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-md py-2 text-body-md font-body-md transition-colors",
            tab.key === active
              ? "border-primary font-semibold text-on-surface"
              : "border-transparent text-on-surface-variant hover:text-on-surface",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
