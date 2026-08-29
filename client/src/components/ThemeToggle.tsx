import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useApp();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return <button className="theme-toggle-btn" type="button" onClick={toggleTheme} title={`Switch to ${nextTheme} mode`} aria-label={`Switch to ${nextTheme} mode`}>{theme === 'light' ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}</button>;
};
