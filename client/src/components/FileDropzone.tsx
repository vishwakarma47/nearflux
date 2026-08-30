import { useRef, useState } from 'react';
import { ArrowRight, FolderOpen, Upload, FileUp, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const FileDropzone: React.FC = () => {
  const { addFiles } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  };
  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setIsDragOver(false);
  };
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) addFiles(event.target.files);
    event.target.value = '';
  };
  const handleDropzoneClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!isCoarsePointer || (event.target instanceof Element && event.target.closest('button'))) return;
    fileInputRef.current?.click();
  };
  const handleDropzoneKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!isCoarsePointer || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    fileInputRef.current?.click();
  };

  return (
    <section
      className={`dropzone ${isDragOver ? 'drag-over' : ''} ${isCoarsePointer ? 'touch-selectable' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleDropzoneClick}
      onKeyDown={handleDropzoneKeyDown}
      tabIndex={isCoarsePointer ? 0 : undefined}
      role={isCoarsePointer ? 'button' : undefined}
      aria-label={isCoarsePointer ? 'Tap to select files to send' : 'Choose files to send'}
    >
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileChange} />
      <input ref={folderInputRef} type="file" multiple hidden onChange={handleFileChange} {...({ webkitdirectory: '', directory: '' } as unknown as React.InputHTMLAttributes<HTMLInputElement>)} />
      <div className="dropzone-orbit" aria-hidden="true"><span className="signal-ring ring-one" /><span className="signal-ring ring-two" /><span className="signal-ring ring-three" /><div className="dropzone-icon-wrapper">{isDragOver ? <FileUp size={34} strokeWidth={1.8} /> : <Upload size={34} strokeWidth={1.8} />}</div><ArrowRight size={20} className="dropzone-arrow" /><div className="dropzone-device-dot" /></div>
      <div className="dropzone-copy"><span className="section-kicker">DIRECT TRANSFER</span><h2>{isDragOver ? 'Drop to transmit' : 'Send files directly'}</h2><p>{isDragOver ? 'Release to start a direct transfer.' : isCoarsePointer ? 'Tap to select files from this device.' : 'Drop files or folders here. Your files travel directly between devices.'}</p></div>
      <div className="dropzone-actions"><button className="btn primary" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} aria-hidden="true" /> Send Files</button><button className="btn secondary" type="button" onClick={() => folderInputRef.current?.click()}><FolderOpen size={15} aria-hidden="true" /> Send Folder</button></div>
      <div className="dropzone-trust"><ShieldCheck size={14} aria-hidden="true" /><span>Direct P2P · Files never pass through the server</span></div>
    </section>
  );
};
