import type { Config } from "tailwindcss";

// Harvest Retail OS design tokens (see specs design assets DESIGN.md). All
// colors are CSS-var driven via rgb(var(--x) / <alpha-value>) so Tailwind
// opacity modifiers (bg-primary/50 etc.) work; concrete values live in each
// app's globals.css :root block.
const m3Color = (cssVar: string) => `rgb(var(${cssVar}) / <alpha-value>)`;

const preset: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        // M3 raw tokens — for direct 1:1 porting of the Stitch mockups.
        primary: m3Color("--color-primary"),
        "on-primary": m3Color("--color-on-primary"),
        "primary-container": m3Color("--color-primary-container"),
        "on-primary-container": m3Color("--color-on-primary-container"),
        "inverse-primary": m3Color("--color-inverse-primary"),
        "primary-fixed": m3Color("--color-primary-fixed"),
        "primary-fixed-dim": m3Color("--color-primary-fixed-dim"),
        "on-primary-fixed": m3Color("--color-on-primary-fixed"),
        "on-primary-fixed-variant": m3Color("--color-on-primary-fixed-variant"),
        "surface-tint": m3Color("--color-surface-tint"),
        secondary: m3Color("--color-secondary"),
        "on-secondary": m3Color("--color-on-secondary"),
        "secondary-container": m3Color("--color-secondary-container"),
        "on-secondary-container": m3Color("--color-on-secondary-container"),
        "secondary-fixed": m3Color("--color-secondary-fixed"),
        "secondary-fixed-dim": m3Color("--color-secondary-fixed-dim"),
        "on-secondary-fixed": m3Color("--color-on-secondary-fixed"),
        "on-secondary-fixed-variant": m3Color("--color-on-secondary-fixed-variant"),
        tertiary: m3Color("--color-tertiary"),
        "on-tertiary": m3Color("--color-on-tertiary"),
        "tertiary-container": m3Color("--color-tertiary-container"),
        "on-tertiary-container": m3Color("--color-on-tertiary-container"),
        "tertiary-fixed": m3Color("--color-tertiary-fixed"),
        "tertiary-fixed-dim": m3Color("--color-tertiary-fixed-dim"),
        "on-tertiary-fixed": m3Color("--color-on-tertiary-fixed"),
        "on-tertiary-fixed-variant": m3Color("--color-on-tertiary-fixed-variant"),
        error: m3Color("--color-error"),
        "on-error": m3Color("--color-on-error"),
        "error-container": m3Color("--color-error-container"),
        "on-error-container": m3Color("--color-on-error-container"),
        surface: m3Color("--color-surface"),
        "on-surface": m3Color("--color-on-surface"),
        "on-surface-variant": m3Color("--color-on-surface-variant"),
        "surface-variant": m3Color("--color-surface-variant"),
        "surface-dim": m3Color("--color-surface-dim"),
        "surface-bright": m3Color("--color-surface-bright"),
        "surface-container-lowest": m3Color("--color-surface-container-lowest"),
        "surface-container-low": m3Color("--color-surface-container-low"),
        "surface-container": m3Color("--color-surface-container"),
        "surface-container-high": m3Color("--color-surface-container-high"),
        "surface-container-highest": m3Color("--color-surface-container-highest"),
        "inverse-surface": m3Color("--color-inverse-surface"),
        "inverse-on-surface": m3Color("--color-inverse-on-surface"),
        outline: m3Color("--color-outline"),
        "outline-variant": m3Color("--color-outline-variant"),
        background: m3Color("--color-background"),
        "on-background": m3Color("--color-on-background"),

        // shadcn/ui-conventional aliases — same underlying vars, so
        // unmodified shadcn component code (bg-primary, text-muted-foreground,
        // border-input, ring-ring, etc.) resolves to the same palette.
        foreground: m3Color("--color-on-background"),
        card: m3Color("--color-surface-container-lowest"),
        "card-foreground": m3Color("--color-on-surface"),
        popover: m3Color("--color-surface-container-lowest"),
        "popover-foreground": m3Color("--color-on-surface"),
        "primary-foreground": m3Color("--color-on-primary"),
        "secondary-foreground": m3Color("--color-on-secondary"),
        muted: m3Color("--color-surface-container"),
        "muted-foreground": m3Color("--color-on-surface-variant"),
        accent: m3Color("--color-surface-container-high"),
        "accent-foreground": m3Color("--color-on-surface"),
        destructive: m3Color("--color-error"),
        "destructive-foreground": m3Color("--color-on-error"),
        border: m3Color("--color-outline-variant"),
        input: m3Color("--color-outline-variant"),
        ring: m3Color("--color-primary"),
      },
      borderRadius: {
        // DESIGN.md's frontmatter table documents a larger scale (lg: 1rem),
        // but the actual Stitch mockup HTML files embed lg: 0.5rem — matching
        // the HTML (what was actually rendered/screenshotted) for fidelity.
        sm: "0.25rem",
        DEFAULT: "0.25rem",
        md: "0.75rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      spacing: {
        base: "4px",
        xs: "8px",
        sm: "16px",
        md: "24px",
        lg: "32px",
        xl: "48px",
        "sidebar-width": "260px",
        "container-margin": "24px",
        gutter: "20px",
      },
      fontSize: {
        "display-stat": ["32px", { lineHeight: "40px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-stat-mobile": ["28px", { lineHeight: "36px", fontWeight: "700" }],
        "headline-lg": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "headline-md": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "700" }],
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
      },
    },
  },
};

export default preset;
