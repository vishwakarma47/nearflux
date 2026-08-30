import { useState } from 'react';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Header';
import { Sidebar, WorkspaceView } from './components/Sidebar';
import { FileDropzone } from './components/FileDropzone';
import { FileList } from './components/FileList';
import { DeviceList } from './components/DeviceList';
import { DeviceOnboardingModal } from './components/DeviceOnboardingModal';
import { TransferProgress } from './components/TransferProgress';
import { TransferRequestModal } from './components/TransferRequestModal';
import { RoomShareModal } from './components/RoomShareModal';
import { RoomInvitePanel } from './components/RoomInvitePanel';
import { TransferWorkspacePanel } from './components/TransferWorkspacePanel';
import { TransferHistoryPanel } from './components/TransferHistoryPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { MobileBottomNav } from './components/MobileBottomNav';

const footerContent: Record<string, { title: string; body: string }> = {
  About: { title: 'About NearFlux', body: 'NearFlux creates direct browser-to-browser file transfers. Your private room is used for presence and signaling; file bytes never pass through or stay on the server.' },
  'How to Use': { title: 'How to Use', body: 'Create or join a room, share its secret link or QR code, select a friend’s device, choose files or a folder, and approve the transfer. Files are sent only after a direct WebRTC connection is verified.' },
  'Privacy Policy': { title: 'Privacy Policy', body: 'NearFlux does not upload, store, or relay transferred files. The signaling service handles room presence and WebRTC negotiation only. Rooms are ephemeral and disappear when participants leave.' },
  FAQ: { title: 'Frequently Asked Questions', body: 'Transfers require a direct P2P path. If the networks cannot establish one, the transfer is cancelled safely. No TURN or server relay fallback is used.' },
  Contact: { title: 'Contact', body: 'For project questions, use the contact channel provided by your deployment owner.' },
};

const viewCopy: Record<WorkspaceView, { kicker: string; title: string; description: string }> = {
  home: { kicker: 'WORKSPACE', title: 'Send files directly', description: 'A private, direct connection between your devices.' },
  transfers: { kicker: 'ACTIVITY', title: 'Transfer history', description: 'Your completed and ended transfers saved in this browser.' },
  devices: { kicker: 'ROOM MEMBERS', title: 'Connected devices', description: 'Choose a device in your active private room.' },
  rooms: { kicker: 'PRIVATE ROOMS', title: 'Room access', description: 'Create, join, and share a room with a friend.' },
  settings: { kicker: 'PREFERENCES', title: 'Settings', description: 'Manage your guest profile, storage, and appearance.' },
};

const ViewHeader: React.FC<{ view: WorkspaceView }> = ({ view }) => <div className="view-header"><div><span className="section-kicker">{viewCopy[view].kicker}</span><h2>{viewCopy[view].title}</h2><p>{viewCopy[view].description}</p></div></div>;

const MainContent: React.FC = () => {
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('home');
  const [isWorkspaceRoomOpen, setIsWorkspaceRoomOpen] = useState(false);
  const info = infoKey ? footerContent[infoKey] : null;
  const navigate = (view: WorkspaceView) => {
    setActiveView(view);
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  };
  const roomOpen = () => setIsWorkspaceRoomOpen(true);

  return <div className="app-container workspace-shell"><a className="skip-link" href="#main-content">Skip to main content</a><Header /><div className="workspace-layout"><Sidebar activeView={activeView} onNavigate={navigate} /><main id="main-content" className="main-content workspace-main" tabIndex={-1}>
    {activeView === 'home' && <><div className="workspace-hero-grid"><FileDropzone /><RoomInvitePanel onOpenShare={roomOpen} /></div><div className="workspace-lower-grid"><DeviceList /><FileList /><TransferWorkspacePanel /></div></>}
    {activeView === 'transfers' && <div className="view-shell"><ViewHeader view="transfers" /><div className="view-two-column"><TransferHistoryPanel /><TransferWorkspacePanel /></div></div>}
    {activeView === 'devices' && <div className="view-shell"><ViewHeader view="devices" /><DeviceList /></div>}
    {activeView === 'rooms' && <div className="view-shell"><ViewHeader view="rooms" /><div className="rooms-view-grid"><RoomInvitePanel onOpenShare={roomOpen} /><div className="workspace-card room-guide-card"><span className="section-kicker">ROOM ACCESS</span><h2>Share a private room</h2><p>Invite a friend with the room link or QR code. Files stay on the direct peer connection once both devices are verified.</p><button className="btn primary" type="button" onClick={roomOpen}>Open room controls</button></div></div></div>}
    {activeView === 'settings' && <div className="view-shell"><ViewHeader view="settings" /><SettingsPanel /></div>}
  </main></div><MobileBottomNav activeView={activeView} onNavigate={navigate} /><TransferRequestModal /><TransferProgress /><DeviceOnboardingModal /><RoomShareModal isOpen={isWorkspaceRoomOpen} onClose={() => setIsWorkspaceRoomOpen(false)} /><footer id="app-footer" className="app-footer"><div className="footer-links" aria-label="Footer navigation">{Object.keys(footerContent).map((label) => <button key={label} type="button" onClick={() => setInfoKey(label)}>{label}</button>)}<button type="button" className="support-link" onClick={() => setInfoKey('About')}>Support Developer</button></div><span>© 2026 <strong>NearFlux Online</strong> · Fast, Private Worldwide P2P Transfers</span></footer>{info && <div className="modal-backdrop" onClick={() => setInfoKey(null)}><div className="modal-card info-modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div className="modal-title-group"><div className="modal-icon-bg">i</div><div><h3 id="info-modal-title">{info.title}</h3></div></div><button className="icon-btn close-btn" type="button" aria-label="Close information dialog" onClick={() => setInfoKey(null)}>×</button></div><p>{info.body}</p><button className="btn primary" type="button" onClick={() => setInfoKey(null)}>Close</button></div></div>}</div>;
};

export const App: React.FC = () => <AppProvider><MainContent /></AppProvider>;
export default App;
