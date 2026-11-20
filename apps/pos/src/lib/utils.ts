import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the design-system font sizes (packages/config/tailwind/preset.ts);
// otherwise e.g. `text-body-lg` is treated as a text *color* and silently drops `text-on-primary`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-stat",
            "display-stat-mobile",
            "headline-lg",
            "headline-md",
            "body-lg",
            "body-md",
            "label-caps",
            "label-sm",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
