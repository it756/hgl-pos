"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getAppliedTheme, setTheme, type Theme } from "../lib/theme/theme";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    setThemeState(getAppliedTheme());
  }, []);

  function handleToggle() {
    const next: Theme = getAppliedTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Button type="button" variant="nav" size="icon" aria-label={label} title={label} onClick={handleToggle}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
