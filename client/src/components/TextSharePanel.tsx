import { Link2, MessageSquareText, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';

export const TextSharePanel: React.FC = () => {
  const { addFiles } = useApp();
  const [text, setText] = useState('');

  const queueText = () => {
    if (!text.trim()) return;
    const fileName = `text-snippet-${Date.now().toString(36)}.txt`;
    addFiles([new File([text], fileName, { type: 'text/plain' })]);
    setText('');
  };

  return (
    <section className="text-share-panel" aria-labelledby="text-share-title">
      <div className="text-share-heading">
        <div className="text-share-icon" aria-hidden="true"><MessageSquareText size={22} /></div>
        <div>
          <span className="section-kicker">DIRECT MESSAGE</span>
          <h2 id="text-share-title">Share text or a link</h2>
          <p>Send a note, code snippet, or URL directly to a device in your private room.</p>
        </div>
      </div>
      <label className="sr-only" htmlFor="text-share-input">Text, code snippet, or link</label>
      <textarea
        id="text-share-input"
        className="text-share-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste text, code snippet, or link to send instantly..."
        spellCheck={false}
      />
      <div className="text-share-actions">
        <span className="text-share-hint"><Link2 size={14} aria-hidden="true" /> Stays private between your devices</span>
        <button className="btn primary" type="button" onClick={queueText} disabled={!text.trim()}>
          <Plus size={16} aria-hidden="true" /> Add Text to Queue
        </button>
      </div>
      <div className="dropzone-trust"><ShieldCheck size={14} aria-hidden="true" /><span>Direct P2P · Text never passes through the server</span></div>
    </section>
  );
};
