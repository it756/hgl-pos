import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-body-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary font-semibold text-on-primary hover:bg-primary/90",
        secondary: "border-transparent bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80",
        outline: "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-primary",
        ghost: "border-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
        destructive: "border-destructive bg-destructive font-semibold text-on-error hover:bg-destructive/90",
        nav: "border-transparent text-on-nav hover:bg-on-nav/10 focus-visible:ring-on-nav focus-visible:ring-offset-nav",
        tile: "h-auto flex-col items-stretch justify-start whitespace-normal border-outline-variant bg-surface-container-lowest p-2.5 text-left text-on-surface hover:border-primary",
      },
      size: {
        default: "min-h-10 px-3 py-2",
        sm: "min-h-9 px-3",
        lg: "min-h-11 px-5",
        xl: "min-h-[52px] px-6 text-body-lg font-semibold",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
