"use client";

import Link from "next/link";
import {
  ClipboardEdit,
  ClipboardList,
  HelpCircle,
  LogOut,
  Menu,
  RotateCcw,
  ShoppingCart,
  Wallet,
} from "lucide-react";
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

// Every navigable page under apps/pos/src/app belongs here (except "/", which
// is a redirect-only landing route, and "/spike", a throwaway dev spike — see
// their own file header comments). Cashier-only actions per the
// constitution's RBAC model — no admin functionality (pricing, inventory,
// transfers, reports) ever belongs here.
export function CashierMenuPopover({ onLogout }: CashierMenuPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="nav" size="icon" aria-label="Till menu">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/sale" className="flex w-full items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Sale
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/refund" className="flex w-full items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Refund / Void
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/count" className="flex w-full items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Stock count
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/adjustments/request" className="flex w-full items-center gap-2">
            <ClipboardEdit className="h-4 w-4" />
            Request adjustment
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
