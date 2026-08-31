import { useRef, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useApp();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const [isSwitching, setIsSwitching] = useState(false);
  const timerRef = useRef<number | null>(null);

  const handleToggle = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setIsSwitching(true);
    toggleTheme();
    timerRef.current = window.setTimeout(() => setIsSwitching(false), 360);
  };

  return <button className="theme-toggle-btn" type="button" onClick={handleToggle} title={`Switch to ${nextTheme} mode`} aria-label={`Switch to ${nextTheme} mode`}><span className={`theme-toggle-icon${isSwitching ? ' switching' : ''}`} aria-hidden="true">{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</span></button>;
};
