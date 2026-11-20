import * as React from "react";
import { cn } from "../../lib/utils";

export const inputClassName =
  "min-h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(inputClassName, className)} {...props} />,
);
Input.displayName = "Input";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(inputClassName, className)} {...props} />,
);
Select.displayName = "Select";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(inputClassName, className)} {...props} />,
);
Textarea.displayName = "Textarea";

function Field({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-body-md text-on-surface-variant", className)}>
      {label}
      {children}
    </label>
  );
}

export { Input, Select, Textarea, Field };
