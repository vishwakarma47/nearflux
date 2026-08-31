import { useState } from 'react';
import { HelpCircle, Laptop, LockKeyhole, Smartphone, Tablet, Wifi, Edit2, QrCode, UserRound } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ThemeToggle } from './ThemeToggle';
import { DeviceNameModal } from './DeviceNameModal';
import { RoomShareModal } from './RoomShareModal';
import { RoomCode } from './RoomCode';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

export const Header: React.FC = () => {
  const { deviceName, isConnected, currentDevice, roomCode } = useApp();
  const connectionStatus = useConnectionStatus(isConnected);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const renderDeviceIcon = () => {
    if (!currentDevice) return <Laptop size={16} strokeWidth={1.8} />;
    if (currentDevice.type === 'mobile') return <Smartphone size={16} strokeWidth={1.8} />;
    if (currentDevice.type === 'tablet') return <Tablet size={16} strokeWidth={1.8} />;
    return <Laptop size={16} strokeWidth={1.8} />;
  };

  return (
    <>
      <header className="app-header">
        <div className="logo-container header-logo-section"><div className="logo-icon-bg header-logo-icon" aria-hidden="true"><Wifi size={21} strokeWidth={2.2} /></div><div className="logo-text"><h1 className="header-logo-title">NearFlux</h1><span className="logo-tagline header-logo-subtitle">Direct P2P file transfer</span></div></div>
        <div className="header-actions header-pills-row">
          <div className={`connection-pill ${connectionStatus.className}`} role="status" aria-live="polite"><span className={`status-dot pulse-dot ${connectionStatus.dotClassName}`} aria-hidden="true" /><span>{connectionStatus.label}</span></div>
          <span className="guest-mode-pill header-guest-pill" title="Transfer history is saved in this browser"><UserRound size={14} aria-hidden="true" /><span>Guest</span></span>
          {roomCode && <button className="device-badge room-pill header-room-badge" type="button" onClick={() => setIsRoomModalOpen(true)} title="Open room sharing" aria-label={`Open sharing for room ${roomCode}`}><LockKeyhole size={14} aria-hidden="true" /><span><span className="header-room-prefix">Room </span><RoomCode code={roomCode} /></span><QrCode size={13} aria-hidden="true" /></button>}
          <button className="device-badge" type="button" onClick={() => setIsEditModalOpen(true)} title="Edit device name" aria-label={`Edit device name, currently ${deviceName}`}>{renderDeviceIcon()}<span>{deviceName}</span><Edit2 size={13} aria-hidden="true" /></button>
          <button className="help-btn header-help-btn" type="button" onClick={() => setIsHelpOpen((open) => !open)} title="How to use" aria-label="How to use NearFlux" aria-expanded={isHelpOpen}><HelpCircle size={17} aria-hidden="true" /></button>
          <ThemeToggle />
        </div>
        {isHelpOpen && <div className="help-popover" role="status"><strong>How to share</strong><span>Create or join a private room, then share its link or QR code. Files are sent only after a direct WebRTC connection is verified.</span></div>}
      </header>
      <DeviceNameModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} />
      <RoomShareModal isOpen={isRoomModalOpen} onClose={() => setIsRoomModalOpen(false)} />
    </>
  );
};
