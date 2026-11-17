'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type SkyBookTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: SkyBookTheme;
  setTheme: (theme: SkyBookTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {}
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<SkyBookTheme>('dark');

  useEffect(() => {
    const saved = window.localStorage.getItem('skybook_theme');
    if (saved === 'light' || saved === 'dark') {
      setThemeState(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const setTheme = (next: SkyBookTheme) => {
    setThemeState(next);
    window.localStorage.setItem('skybook_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}