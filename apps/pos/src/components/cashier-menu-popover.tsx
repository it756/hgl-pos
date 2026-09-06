"use client";

import Link from "next/link";
import { HelpCircle, LogOut, Menu, Wallet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { SyncStatusChip } from "./sync-status-chip";
import { Button } from "./ui/button";

export type CashierMenuPopoverProps = {
  onLogout?: () => void;
};

// Cashier-only actions per the constitution's RBAC model — no admin
// functionality (pricing, inventory, transfers, reports) ever belongs here.
export function CashierMenuPopover({ onLogout }: CashierMenuPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Till menu">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/sync-health" className="flex w-full items-center gap-2">
            <SyncStatusChip />
            Sync status
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="mailto:support@harvestgroup.example" className="flex w-full items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            Help
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/shift/close" className="flex w-full items-center gap-2">
            <Wallet className="h-4 w-4" />
            Cash-up / End shift
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={onLogout === undefined} onSelect={onLogout} className="gap-2 text-destructive">
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
