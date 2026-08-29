import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle, FileText, ShieldCheck, X, Gauge } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatBytes, formatSpeed, formatTime } from '../utils/formatters';

export const TransferProgress: React.FC = () => {
  const { transferState, cancelTransfer, closeTransfer } = useApp();
  if (transferState.status === 'idle') return null;

  const ended = ['completed', 'cancelled', 'failed'].includes(transferState.status);
  const closeOrCancel = () => ended ? closeTransfer() : cancelTransfer();
  const statusMessage = {
    pending_approval: `Waiting for ${transferState.peerDeviceName || 'recipient(s)'} to accept...`,
    connecting: 'Establishing a direct WebRTC connection...',
    checking_direct_connection: 'Checking that the selected connection is direct...',
    ready_for_transfer: 'Direct P2P verified. Preparing file data channel...',
    transferring: `Transferring file (${transferState.currentFileIndex || 1}/${transferState.totalFiles || 1})`,
    completed: 'Transfer completed successfully.',
    failed: transferState.error || 'Direct P2P transfer failed.',
    cancelled: 'Transfer was cancelled.',
    idle: '',
  }[transferState.status];
  const statusLabel = transferState.status === 'failed' ? 'Direct P2P unavailable' : transferState.status === 'ready_for_transfer' || transferState.status === 'transferring' || transferState.status === 'completed' ? 'Direct P2P connection' : 'Direct P2P only';

  return (
    <div className="transfer-modal-overlay" role="presentation">
      <div className="transfer-card popup-box" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
        <div className="transfer-header">
          <div className="transfer-type"><div className={`transfer-icon-badge ${transferState.role}`} aria-hidden="true">{transferState.role === 'sender' ? <ArrowUpRight size={21} /> : <ArrowDownLeft size={21} />}</div><div><span className="section-kicker">{transferState.role === 'sender' ? 'OUTGOING TRANSFER' : 'INCOMING TRANSFER'}</span><h3 id="transfer-title">{transferState.role === 'sender' ? 'Sending files' : 'Receiving files'}</h3><p className="transfer-peer-subtitle">{transferState.role === 'sender' ? 'To: ' : 'From: '}<strong>{transferState.peerDeviceName || 'Device'}</strong></p></div></div>
          <button className="icon-btn close-btn" type="button" onClick={closeOrCancel} title={ended ? 'Close transfer' : 'Cancel transfer'} aria-label={ended ? 'Close transfer dialog' : 'Cancel transfer'}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="transfer-body">
          <div className={`direct-status-card ${transferState.status === 'failed' ? 'status-failed' : ''}`}><ShieldCheck size={17} aria-hidden="true" /><div><strong>{statusLabel}</strong><span>{transferState.connectionType ? `Candidate: ${transferState.connectionType}` : 'Server: signaling only · Relay: disabled'}</span></div></div>
          <div className="file-info-card"><div className="file-info-main"><FileText size={21} className="file-icon" aria-hidden="true" /><div className="file-text-details"><span className="file-title" title={transferState.currentFileName}>{transferState.currentFileName || statusMessage}</span>{transferState.currentFileName && <span className="file-type-badge">{transferState.currentFileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>}</div></div></div>
          <div className="progress-bar-container" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={transferState.progress} aria-label="Transfer progress"><div className={`progress-bar-fill ${transferState.status}`} style={{ width: `${transferState.progress}%` }} /></div>
          <div className="transfer-stats-row"><span className="progress-percent">{transferState.progress.toFixed(1)}%</span>{transferState.fileSize !== undefined && <span className="transferred-bytes">{formatBytes(transferState.transferredBytes)} / {formatBytes(transferState.fileSize)}</span>}</div>
          {transferState.status === 'transferring' && <div className="transfer-meta-row"><span><Gauge size={13} aria-hidden="true" /> <strong>Speed</strong> {formatSpeed(transferState.speed)}</span><span><strong>ETA</strong> {formatTime(transferState.timeRemaining)}</span></div>}
          {transferState.status === 'completed' && <div className="transfer-status-msg success" role="status"><CheckCircle size={17} aria-hidden="true" /> <span>Saved locally. The server received no file data.</span></div>}
          {(transferState.status === 'failed' || transferState.status === 'cancelled') && <div className="transfer-status-msg error" role="alert"><AlertCircle size={17} aria-hidden="true" /> <span>{statusMessage} No relay or upload fallback is available.</span></div>}
        </div>
        <div className="transfer-actions"><button className="btn secondary danger-hover" type="button" onClick={closeOrCancel}>{ended ? 'Close' : 'Cancel transfer'}</button></div>
      </div>
    </div>
  );
};
