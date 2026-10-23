import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

export type ThemeContextValue = {
  currentTheme: Theme;
  changeCurrentTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: "light",
  changeCurrentTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export type ThemeProviderProps = {
  storageKey?: string;
  children: ReactNode;
};

export function ThemeProvider({ storageKey = "theme", children }: ThemeProviderProps) {
  const [currentTheme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === "dark" ? "dark" : "light";
  });

  const changeCurrentTheme = (theme: Theme) => {
    setTheme(theme);
    localStorage.setItem(storageKey, theme);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tw-transition-duration", "0s");
    root.classList.toggle("dark", currentTheme === "dark");
    root.style.colorScheme = currentTheme;
    const t = setTimeout(() => root.style.removeProperty("--tw-transition-duration"), 1);
    return () => clearTimeout(t);
  }, [currentTheme]);

  return (
    <ThemeContext.Provider value={{ currentTheme, changeCurrentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
