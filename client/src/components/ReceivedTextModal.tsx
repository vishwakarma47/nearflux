import { CheckCircle2, Copy, MessageSquareText, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';

export const ReceivedTextModal: React.FC = () => {
  const { receivedText, clearReceivedText } = useApp();
  const [copied, setCopied] = useState(false);

  if (!receivedText) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(receivedText.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop received-text-backdrop" onClick={clearReceivedText}>
      <div className="modal-card received-text-modal" role="dialog" aria-modal="true" aria-labelledby="received-text-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-bg received-text-icon"><MessageSquareText size={18} aria-hidden="true" /></div>
            <div><span className="section-kicker">TEXT / LINK RECEIVED</span><h3 id="received-text-title">Direct message received</h3></div>
          </div>
          <button className="icon-btn close-btn" type="button" aria-label="Close received text dialog" onClick={clearReceivedText}><X size={18} aria-hidden="true" /></button>
        </div>
        <p className="received-text-meta">{receivedText.peerDeviceName ? `From ${receivedText.peerDeviceName}` : 'Received from a direct P2P peer'} · {receivedText.fileName}</p>
        <pre className="received-text-content">{receivedText.text}</pre>
        <div className="received-text-footer"><span className="received-text-private"><CheckCircle2 size={14} aria-hidden="true" /> Saved only in this browser session</span><button className="btn primary" type="button" onClick={copyText}><Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy Text'}</button></div>
      </div>
    </div>
  );
};
