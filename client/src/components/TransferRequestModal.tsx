import React from 'react';
import { Download, X, File, Check, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatBytes } from '../utils/formatters';

export const TransferRequestModal: React.FC = () => {
  const { incomingRequest, acceptIncomingRequest, rejectIncomingRequest } = useApp();
  if (!incomingRequest) return null;
  const totalSize = incomingRequest.files.reduce((acc, curr) => acc + curr.size, 0);

  return (
    <div className="modal-backdrop">
      <div className="modal-card transfer-request-modal" role="dialog" aria-modal="true" aria-labelledby="request-title">
        <div className="modal-header"><div className="modal-title-group"><div className="modal-icon-bg"><Download size={18} aria-hidden="true" /></div><div><span className="section-kicker">DIRECT P2P REQUEST</span><h3 id="request-title">Incoming transfer</h3><span className="modal-subtitle">Review the files before accepting them.</span></div></div><button className="icon-btn close-btn" type="button" onClick={rejectIncomingRequest} title="Decline transfer" aria-label="Decline transfer"><X size={18} aria-hidden="true" /></button></div>
        <div className="request-body"><div className="sender-info-box"><p className="sender-prompt"><strong className="sender-name">{incomingRequest.senderName}</strong> wants to send you <span className="highlight-badge">{incomingRequest.files.length} {incomingRequest.files.length === 1 ? 'file' : 'files'}</span></p><span className="total-size-tag">{formatBytes(totalSize)} total</span></div><div className="request-trust"><ShieldCheck size={15} aria-hidden="true" /><span>Files will be received directly over a verified P2P connection.</span></div><div className="file-preview-list">{incomingRequest.files.map((file, index) => <div key={index} className="request-file-item"><div className="file-item-left"><File size={17} className="file-type-icon" aria-hidden="true" /><span className="file-name" title={file.name}>{file.name}</span></div><span className="file-size-badge">{formatBytes(file.size)}</span></div>)}</div></div>
        <div className="modal-actions"><button className="btn secondary danger-hover" type="button" onClick={rejectIncomingRequest}>Decline</button><button className="btn primary" type="button" onClick={acceptIncomingRequest}><Check size={16} aria-hidden="true" /> Accept &amp; receive</button></div>
      </div>
    </div>
  );
};
