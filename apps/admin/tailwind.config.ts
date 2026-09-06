import type { Config } from "tailwindcss";
import sharedPreset from "@hgl/config/tailwind/preset";

const config: Config = {
  presets: [sharedPreset],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  plugins: [],
};

export default config;
