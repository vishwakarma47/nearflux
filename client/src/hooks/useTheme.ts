import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('NearFlux_theme') as Theme | null;
    if (saved) return saved;
    return 'dark';
  });

  useEffect(() => {
    localStorage.setItem('NearFlux_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setTheme(nextTheme);
      return;
    }

    // Restart the wash when the user toggles quickly, then update the token set
    // in the same frame so the whole workspace transitions together.
    root.classList.remove('theme-transitioning');
    void root.offsetWidth;
    root.classList.add('theme-transitioning');
    root.setAttribute('data-theme', nextTheme);
    localStorage.setItem('NearFlux_theme', nextTheme);
    setTheme(nextTheme);
    window.setTimeout(() => root.classList.remove('theme-transitioning'), 440);
  };

  return { theme, toggleTheme };
}
