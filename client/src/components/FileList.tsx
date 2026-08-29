import { File, Send, Trash2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatBytes } from '../utils/formatters';

export const FileList: React.FC = () => {
  const { selectedFiles, removeFile, clearFiles, selectedTargetDevices, startTransfer } = useApp();
  if (selectedFiles.length === 0) return null;

  const totalSize = selectedFiles.reduce((total, file) => total + file.size, 0);
  const targetCount = selectedTargetDevices.length;
  const sendLabel = targetCount === 0 ? 'Select a target device above' : targetCount === 1 ? `Send directly to ${selectedTargetDevices[0].name}` : `Send directly to ${targetCount} devices`;

  return (
    <section className="section-card selected-files-section" aria-labelledby="selected-files-title">
      <div className="section-header">
        <div>
          <div className="section-title-row"><span className="section-icon file-section-icon" aria-hidden="true"><File size={16} /></span><div><span className="section-kicker">TRANSFER QUEUE</span><h2 id="selected-files-title">Selected files</h2></div></div>
          <span className="subtitle"><strong>{selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'}</strong> · {formatBytes(totalSize)} total</span>
        </div>
        <button className="btn text-danger" type="button" onClick={clearFiles} title="Clear all selected files"><Trash2 size={15} aria-hidden="true" /> Clear all</button>
      </div>
      <div className="file-list">
        {selectedFiles.map((file) => (
          <div key={file.id} className="file-item">
            <div className="file-icon-bg" aria-hidden="true"><File size={19} /></div>
            <div className="file-details"><span className="file-name" title={file.relativePath || file.name}>{file.relativePath || file.name}</span><span className="file-meta">{formatBytes(file.size)} <span aria-hidden="true">·</span> {file.type || 'Binary file'}</span></div>
            <button className="icon-btn remove-btn" type="button" onClick={() => removeFile(file.id)} title={`Remove ${file.relativePath || file.name}`} aria-label={`Remove ${file.relativePath || file.name}`}><X size={16} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <div className="transfer-actions"><button className="btn primary send-btn" type="button" disabled={targetCount === 0} onClick={startTransfer}><Send size={16} aria-hidden="true" /> {sendLabel}</button><span className="transfer-note">Direct WebRTC connection · No server relay</span></div>
    </section>
  );
};
