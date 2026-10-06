"use client";

import * as React from "react";

type Theme = "dark" | "light";
const Ctx = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }>({
  theme: "dark", setTheme: () => {}, toggle: () => {},
});

export const themeInitScript = `(function(){try{var t=localStorage.getItem('nexa-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("dark");
  React.useEffect(() => {
    setThemeState(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("nexa-theme", t); } catch { /* storage unavailable */ }
  }, []);
  const value = React.useMemo(() => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => React.useContext(Ctx);
