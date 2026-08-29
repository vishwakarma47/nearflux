import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock3, Trash2, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TransferHistoryItem } from '../types/index.js';
import { formatBytes } from '../utils/formatters';

const statusLabel: Record<TransferHistoryItem['status'], string> = { completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };

export const TransferHistoryPanel: React.FC = () => {
  const { transferHistory, clearTransferHistory } = useApp();
  return <section className="history-card workspace-card" aria-labelledby="history-title"><div className="panel-heading"><div className="panel-title"><span className="panel-icon transfer-panel-icon"><Clock3 size={16} aria-hidden="true" /></span><div><span className="section-kicker">LOCAL ACTIVITY</span><h2 id="history-title">Transfer history</h2></div></div>{transferHistory.length > 0 && <button className="btn text-danger" type="button" onClick={clearTransferHistory}><Trash2 size={14} aria-hidden="true" /> Clear</button>}</div>{transferHistory.length === 0 ? <div className="history-empty"><div className="workspace-empty-icon"><Clock3 size={17} aria-hidden="true" /></div><strong>No transfers yet</strong><span>Completed and ended transfers will be saved here in guest mode.</span></div> : <div className="history-list">{transferHistory.map((item) => <div className="history-item" key={item.id}><div className={`history-direction ${item.direction}`} aria-hidden="true">{item.direction === 'sent' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}</div><div className="history-details"><strong title={item.fileName}>{item.fileName}</strong><span>{item.direction === 'sent' ? 'Sent' : 'Received'} · {item.peerDeviceName} · {formatBytes(item.totalBytes)}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div><span className={`history-status ${item.status}`}>{item.status === 'completed' ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}{statusLabel[item.status]}</span></div>)}</div>}</section>;
};
