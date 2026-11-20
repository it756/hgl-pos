"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  hideClose?: boolean;
};

// Right-hand slide-over drawer (mockup `.drawer`). Radix handles Esc-to-close,
// focus trapping and restoring focus to the trigger.
const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ className, children, title, description, hideClose = false, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(450px,100%)] flex-col gap-2.5 overflow-y-auto border-l border-outline-variant bg-surface-container-lowest p-5 pt-[calc(20px+env(safe-area-inset-top,0px))] text-on-surface shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-2">
          <DialogPrimitive.Title className="text-headline-md font-semibold text-on-surface">{title}</DialogPrimitive.Title>
          {!hideClose && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          )}
        </div>
        {description === undefined ? (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="text-body-md text-on-surface-variant">{description}</DialogPrimitive.Description>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
SheetContent.displayName = "SheetContent";

export { Sheet, SheetTrigger, SheetClose, SheetContent };
