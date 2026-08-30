import { useState } from 'react';
import { Check, Copy, Link2, LockKeyhole, Share2 } from 'lucide-react';
import { LazyQRCode } from './LazyQRCode';
import { useApp } from '../context/AppContext';
import { getShareLink } from '../utils/room';
import { RoomCode } from './RoomCode';
import { ShareRoomButton } from './ShareRoomButton';

interface RoomInvitePanelProps { onOpenShare: () => void; }

export const RoomInvitePanel: React.FC<RoomInvitePanelProps> = ({ onOpenShare }) => {
  const { roomCode } = useApp();
  const [copied, setCopied] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const shareLink = roomCode ? getShareLink(roomCode) : '';
  const copyLink = async () => {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };

  return (
    <section className="workspace-card room-invite-panel" aria-labelledby="room-panel-title">
      <div className="panel-heading"><div className="panel-title"><span className="panel-icon room-panel-icon"><LockKeyhole size={16} aria-hidden="true" /></span><div><span className="section-kicker">PRIVATE ROOM</span><h2 id="room-panel-title">Your room</h2></div></div><ShareRoomButton onClick={onOpenShare} label="Open room sharing" iconOnly /></div>
      {roomCode ? <><RoomCode code={roomCode} className="invite-code" /><span className="invite-subtitle">Share this room to let others join</span><div className={`invite-qr ${showMobileQr ? 'show-mobile-qr' : ''}`}><LazyQRCode value={shareLink} size={156} bgColor="#ffffff" fgColor="#132238" level="M" includeMargin /></div><button className="qr-toggle-btn" type="button" onClick={() => setShowMobileQr((visible) => !visible)} aria-expanded={showMobileQr}>{showMobileQr ? 'Hide QR code' : 'Show QR to share'}</button><div className="invite-link" title={shareLink}><Link2 size={13} aria-hidden="true" /><span>{shareLink}</span><button className={copied ? 'is-copied' : ''} type="button" onClick={copyLink} aria-label={copied ? 'Room link copied' : 'Copy room link'} title={copied ? 'Copied!' : 'Copy room link'}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button></div><button className="btn secondary room-share-cta" type="button" onClick={copyLink}><Share2 size={15} aria-hidden="true" /> {copied ? 'Copied!' : 'Share room link'}</button><span className="invite-footnote" aria-live="polite">{copied ? 'Room link copied to clipboard' : 'Anyone with the link or code can join'}</span></> : <div className="invite-empty"><p>No active room yet.</p><button className="btn primary" type="button" onClick={onOpenShare}>Create or join room</button></div>}
    </section>
  );
};
