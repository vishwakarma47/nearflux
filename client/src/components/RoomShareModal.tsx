import { useState } from 'react';
import { Check, Copy, Link2, LockKeyhole, QrCode, RefreshCw, X, ArrowUpRight, DoorOpen } from 'lucide-react';
import { LazyQRCode } from './LazyQRCode';
import { useApp } from '../context/AppContext';
import { getShareLink } from '../utils/room';
import { RoomCode } from './RoomCode';

interface RoomShareModalProps { isOpen: boolean; onClose: () => void; }

export const RoomShareModal: React.FC<RoomShareModalProps> = ({ isOpen, onClose }) => {
  const { roomCode, isRoomCreator, joinRoom, createRoom, closeRoom, roomError } = useApp();
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const shareLink = roomCode ? getShareLink(roomCode) : '';
  if (!isOpen) return null;

  const copyShareLink = async () => {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  const handleJoin = (event: React.FormEvent) => { event.preventDefault(); joinRoom(joinCode); setJoinCode(''); onClose(); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card room-modal" role="dialog" aria-modal="true" aria-labelledby="room-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div className="modal-title-group"><div className="modal-icon-bg"><LockKeyhole size={18} aria-hidden="true" /></div><div><span className="section-kicker">PRIVATE ROOM</span><h3 id="room-modal-title">Share your room</h3><span className="modal-subtitle">Connect devices directly, anywhere.</span></div></div><button className="icon-btn close-btn" type="button" onClick={onClose} title="Close" aria-label="Close room sharing"><X size={18} aria-hidden="true" /></button></div>
        {roomCode ? <><div className="room-share-panel"><span className="eyebrow">Your room code</span><RoomCode code={roomCode} className="room-code-large" /><div className="room-invite-qr"><LazyQRCode value={shareLink} size={176} bgColor="#ffffff" fgColor="#132238" level="M" includeMargin /></div><span className="qr-caption"><QrCode size={14} aria-hidden="true" /> Scan with a phone camera to join</span><div className="share-link-row" title={shareLink}><Link2 size={14} aria-hidden="true" /><span>{shareLink}</span></div></div><button className="btn primary share-link-button" type="button" onClick={copyShareLink}><span className="copy-action-icon">{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}</span> {copied ? 'Copied!' : 'Copy share link'}</button><div className="modal-actions split-actions">{isRoomCreator && <button className="btn danger-outline" type="button" onClick={() => { closeRoom(); onClose(); }}><DoorOpen size={15} aria-hidden="true" /> Close room</button>}<button className="btn secondary" type="button" onClick={() => { createRoom(); onClose(); }}><RefreshCw size={15} aria-hidden="true" /> New code</button></div></> : <div className="empty-room-panel"><p>{roomError || 'No active room.'}</p><button className="btn primary" type="button" onClick={() => { createRoom(); onClose(); }}>Create new room <ArrowUpRight size={15} aria-hidden="true" /></button></div>}
        <div className="join-divider"><span>OR JOIN ANOTHER ROOM</span></div>
        <form className="join-room-form" onSubmit={handleJoin}><label htmlFor="join-code-input">Enter a code from a friend</label><div className="join-input-row"><input id="join-code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="FLUX-8291" maxLength={9} autoComplete="off" /><button className="btn secondary" type="submit" disabled={!joinCode.trim()}>Join <ArrowUpRight size={15} aria-hidden="true" /></button></div></form>
      </div>
    </div>
  );
};
