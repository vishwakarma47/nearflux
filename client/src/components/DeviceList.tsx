import { useState } from 'react';
import { CheckSquare, LockKeyhole, Radar, Square, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { DeviceCard } from './DeviceCard';
import { RoomShareModal } from './RoomShareModal';
import { Device } from '../types/index.js';
import { RoomCode } from './RoomCode';
import { ShareRoomButton } from './ShareRoomButton';

export const DeviceList: React.FC = () => {
  const { roomCode, roomError, nearbyDevices, selectedTargetDevices, toggleTargetDevice, selectAllTargetDevices, clearTargetDevices } = useApp();
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const allSelected = nearbyDevices.length > 0 && selectedTargetDevices.length === nearbyDevices.length;
  const toggleSelectAll = () => allSelected ? clearTargetDevices() : selectAllTargetDevices();

  return (
    <>
      <section className="section-card devices-section" aria-labelledby="devices-title">
        <div className="section-header">
          <div>
            <div className="section-title-row"><span className="section-icon" aria-hidden="true"><Users size={16} /></span><div><span className="section-kicker">ROOM MEMBERS</span><h2 id="devices-title">Connected devices</h2></div>{roomCode && <span className="room-badge"><LockKeyhole size={12} aria-hidden="true" /> <RoomCode code={roomCode} /></span>}</div>
            <span className="subtitle">{roomCode ? <>Only devices with the secret code <RoomCode code={roomCode} /> are visible here.</> : 'Create or join a room to see connected devices.'}</span>
          </div>
          <div className="section-actions">
            {nearbyDevices.length > 0 && <button className="btn text-btn" type="button" onClick={toggleSelectAll}>{allSelected ? <CheckSquare size={15} aria-hidden="true" /> : <Square size={15} aria-hidden="true" />}{allSelected ? 'Deselect all' : 'Select all'}</button>}
            <ShareRoomButton onClick={() => setIsRoomModalOpen(true)} label="Share room" />
          </div>
        </div>
        {roomError && <div className="inline-alert" role="alert">{roomError}</div>}
        {nearbyDevices.length === 0 ? (
          <div className="empty-state">
            <div className="radar-pulse" aria-hidden="true"><Radar size={32} className="pulse-icon" /></div>
            <p className="empty-title">{roomCode ? <>Waiting for friends to join <RoomCode code={roomCode} /></> : 'No active room'}</p>
            <p className="empty-desc">{roomCode ? 'Share the private room link or QR code to connect a device.' : 'Create a new private room or join one with a friend.'}</p>
            <ShareRoomButton className="secondary" onClick={() => setIsRoomModalOpen(true)} label={roomCode ? 'Share room link' : 'Create or join room'} />
          </div>
        ) : (
          <div className="device-grid">{nearbyDevices.map((device: Device) => <DeviceCard key={device.id} device={device} isSelected={selectedTargetDevices.some((item) => item.id === device.id)} onSelect={toggleTargetDevice} />)}</div>
        )}
      </section>
      <RoomShareModal isOpen={isRoomModalOpen} onClose={() => setIsRoomModalOpen(false)} />
    </>
  );
};
