import { ArrowDownToLine, Home, Monitor, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { RoomCode } from './RoomCode';

export type WorkspaceView = 'home' | 'transfers' | 'devices' | 'rooms' | 'settings';

const navItems: Array<{ id: WorkspaceView; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'transfers', label: 'Transfers', icon: ArrowDownToLine },
  { id: 'devices', label: 'Devices', icon: Monitor },
  { id: 'rooms', label: 'Rooms', icon: UsersRound },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface SidebarProps { activeView: WorkspaceView; onNavigate: (view: WorkspaceView) => void; }

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onNavigate }) => {
  const { roomCode } = useApp();
  return <aside className="workspace-sidebar" aria-label="Workspace navigation"><nav className="sidebar-nav"><span className="sidebar-label">NAV</span>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`sidebar-nav-item ${activeView === id ? 'active' : ''}`} type="button" onClick={() => onNavigate(id)} aria-current={activeView === id ? 'page' : undefined} title={label} aria-label={label}><Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sidebar-tooltip" role="tooltip" aria-hidden="true">{label}</span></button>)}</nav><div className="sidebar-spacer" /><div className="sidebar-privacy" title="Direct P2P only"><ShieldCheck size={17} aria-hidden="true" /><strong>P2P</strong><span>Direct only</span></div>{roomCode && <div className="sidebar-room-code" aria-label={`Current room ${roomCode}`}><span>ROOM</span><RoomCode code={roomCode} /></div>}<span className="sidebar-version">v1.0.0</span></aside>;
};
