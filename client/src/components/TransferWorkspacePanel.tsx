import { ArrowUpRight, CheckCircle2, FileText, Gauge, ListFilter } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatBytes, formatSpeed, formatTime } from '../utils/formatters';

export const TransferWorkspacePanel: React.FC = () => {
  const { transferState } = useApp();
  const active = transferState.status !== 'idle';
  const ended = ['completed', 'failed', 'cancelled'].includes(transferState.status);
  const role = transferState.role === 'receiver' ? 'Receiving' : 'Sending';
  return (
    <section id="transfer-workspace" className="workspace-card transfers-panel" aria-labelledby="transfers-panel-title">
      <div className="panel-heading"><div className="panel-title"><span className="panel-icon transfer-panel-icon"><ListFilter size={16} aria-hidden="true" /></span><div><span className="section-kicker">ACTIVITY</span><h2 id="transfers-panel-title">Active transfer</h2></div></div><span className={`panel-count ${active ? 'has-active' : ''}`}>{active ? '1' : '0'}</span></div>
      {active ? <div className="workspace-transfer-list"><div className="workspace-transfer-item"><div className={`workspace-transfer-file ${ended ? 'ended' : ''}`}><FileText size={18} aria-hidden="true" /></div><div className="workspace-transfer-details"><strong title={transferState.currentFileName}>{transferState.currentFileName || `${role} files`}</strong><span>{role} · {transferState.peerDeviceName || 'Device'}</span>{transferState.status === 'transferring' && <span className="workspace-transfer-meta"><Gauge size={12} aria-hidden="true" /> {formatSpeed(transferState.speed)} · {formatTime(transferState.timeRemaining)}</span>}</div><div className="workspace-transfer-status">{ended ? <><CheckCircle2 size={15} aria-hidden="true" /> {transferState.status === 'completed' ? 'Completed' : 'Ended'}</> : <strong>{transferState.progress.toFixed(0)}%</strong>}</div></div>{transferState.fileSize !== undefined && <div className="workspace-progress"><span style={{ width: `${transferState.progress}%` }} /></div>}<span className="workspace-transfer-subline">{transferState.fileSize !== undefined ? `${formatBytes(transferState.transferredBytes)} / ${formatBytes(transferState.fileSize)}` : 'Direct WebRTC connection'}</span></div> : <div className="workspace-empty"><div className="workspace-empty-icon"><ArrowUpRight size={18} aria-hidden="true" /></div><strong>No active transfers</strong><span>Your transfer activity will appear here.</span></div>}
    </section>
  );
};
