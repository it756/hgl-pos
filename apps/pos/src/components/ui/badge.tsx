import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-label-sm font-semibold",
  {
    variants: {
      variant: {
        default: "bg-primary-fixed text-on-primary-fixed-variant dark:bg-primary-container dark:text-on-primary-container",
        secondary: "bg-secondary-container text-on-secondary-container",
        success: "bg-success-container text-success",
        warning: "bg-warning-container text-warning",
        destructive: "bg-error-container text-on-error-container",
        neutral: "bg-surface-container text-on-surface-variant",
        outline: "border border-outline-variant text-on-surface-variant",
        nav: "bg-on-nav/15 text-on-nav",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
