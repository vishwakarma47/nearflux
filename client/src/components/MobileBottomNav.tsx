import { ArrowDownToLine, Home, Monitor, Settings, UsersRound } from 'lucide-react';
import type { WorkspaceView } from './Sidebar';

const navItems: Array<{ id: WorkspaceView; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'transfers', label: 'Transfers', icon: ArrowDownToLine },
  { id: 'devices', label: 'Devices', icon: Monitor },
  { id: 'rooms', label: 'Rooms', icon: UsersRound },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface MobileBottomNavProps {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeView, onNavigate }) => (
  <nav className="mobile-bottom-nav" aria-label="Mobile workspace navigation">
    {navItems.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        className={`mobile-bottom-nav-item ${activeView === id ? 'active' : ''}`}
        type="button"
        onClick={() => onNavigate(id)}
        aria-current={activeView === id ? 'page' : undefined}
        aria-label={label}
      >
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>{label}</span>
      </button>
    ))}
  </nav>
);
