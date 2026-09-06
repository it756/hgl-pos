"use client";

import { usePathname } from "next/navigation";
import { HelpCircle, LogOut, Settings } from "lucide-react";
import { useSessionClaims } from "./auth-provider";
import { signOut } from "../lib/supabase/sign-out";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/sync-health": "Sync Health",
};

export function AppTopbar() {
  const pathname = usePathname();
  const claims = useSessionClaims();
  const title = PAGE_TITLES[pathname] ?? "Harvest POS";
  const initials = (claims?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant bg-surface px-md py-sm">
      <h2 className="text-headline-md font-headline-md font-extrabold text-on-surface">{title}</h2>

      <div className="flex items-center gap-xs">
        <button
          type="button"
          className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
          aria-label="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar>
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-semibold text-on-surface">{claims?.email ?? "Unknown user"}</span>
                <span className="text-label-sm font-normal text-on-surface-variant">{claims?.role ?? "unknown role"}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()} className="text-destructive">
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
