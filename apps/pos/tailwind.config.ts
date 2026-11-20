import type { Config } from "tailwindcss";
import sharedPreset from "@hgl/config/tailwind/preset";

const tokenColor = (cssVar: string) => `rgb(var(${cssVar}) / <alpha-value>)`;

const config: Config = {
  presets: [sharedPreset],
  // Theme is switched by `data-theme` on <html> (see src/lib/theme/theme.ts),
  // not by a `.dark` class, so `dark:` utilities follow the same switch.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        success: tokenColor("--color-success"),
        "success-container": tokenColor("--color-success-container"),
        warning: tokenColor("--color-warning"),
        "warning-container": tokenColor("--color-warning-container"),
        nav: tokenColor("--color-nav"),
        "on-nav": tokenColor("--color-on-nav"),
        "nav-muted": tokenColor("--color-nav-muted"),
      },
    },
  },
  plugins: [],
};

export default config;
