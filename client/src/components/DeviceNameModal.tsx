import React, { useState, useEffect } from 'react';
import { X, Check, Edit3 } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface DeviceNameModalProps { isOpen: boolean; onClose: () => void; }

export const DeviceNameModal: React.FC<DeviceNameModalProps> = ({ isOpen, onClose }) => {
  const { deviceName, updateDeviceName } = useApp();
  const [name, setName] = useState(deviceName);
  useEffect(() => { setName(deviceName); }, [deviceName, isOpen]);
  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim()) { updateDeviceName(name.trim()); onClose(); }
  };
  const isUnchangedOrEmpty = !name.trim() || name.trim() === deviceName;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card edit-device-modal" role="dialog" aria-modal="true" aria-labelledby="device-name-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div className="modal-title-group"><div className="modal-icon-bg"><Edit3 size={18} aria-hidden="true" /></div><div><span className="section-kicker">DEVICE PROFILE</span><h3 id="device-name-title">Rename your device</h3><span className="modal-subtitle">This is how friends will see you in your private room.</span></div></div><button className="icon-btn close-btn" type="button" onClick={onClose} title="Close" aria-label="Close device name dialog"><X size={18} aria-hidden="true" /></button></div>
        <form onSubmit={handleSubmit} className="modal-form"><div className="form-group"><label htmlFor="device-name-input" className="form-label">Device name</label><div className="input-wrapper"><input id="device-name-input" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. John's Laptop" maxLength={32} autoFocus autoComplete="name" className="modal-input" /><span className="char-counter">{name.length}/32</span></div><span className="form-hint">Use a name your friend can recognize quickly.</span></div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={isUnchangedOrEmpty}><Check size={16} aria-hidden="true" /> Save name</button></div></form>
      </div>
    </div>
  );
};
