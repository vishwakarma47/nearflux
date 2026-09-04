import { useState } from 'react';
import { FileUp, MessageSquareText } from 'lucide-react';
import { FileDropzone } from './FileDropzone';
import { TextSharePanel } from './TextSharePanel';

type TransferMode = 'files' | 'text';

export const TransferComposer: React.FC = () => {
  const [mode, setMode] = useState<TransferMode>('files');

  return (
    <div className="transfer-composer">
      <div className="transfer-mode-tabs" role="tablist" aria-label="Transfer type">
        <button
          className={`transfer-mode-tab ${mode === 'files' ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={mode === 'files'}
          aria-controls="files-transfer-panel"
          onClick={() => setMode('files')}
        >
          <FileUp size={15} aria-hidden="true" /> Files &amp; Folders
        </button>
        <button
          className={`transfer-mode-tab ${mode === 'text' ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={mode === 'text'}
          aria-controls="text-transfer-panel"
          onClick={() => setMode('text')}
        >
          <MessageSquareText size={15} aria-hidden="true" /> Share Text / Link
        </button>
      </div>
      <div id={mode === 'files' ? 'files-transfer-panel' : 'text-transfer-panel'} role="tabpanel">
        {mode === 'files' ? <FileDropzone /> : <TextSharePanel />}
      </div>
    </div>
  );
};
