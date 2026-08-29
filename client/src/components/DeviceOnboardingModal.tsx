import { useState } from 'react';
import { Check, Laptop, RotateCcw, Link2, FolderOpen, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const DeviceOnboardingModal: React.FC = () => {
  const { deviceName, updateDeviceName } = useApp();
  const [name, setName] = useState(deviceName);
  const [isOpen, setIsOpen] = useState(() => !localStorage.getItem('NearFlux_onboarding_complete'));
  if (!isOpen) return null;

  const complete = (nextName: string) => { if (!nextName.trim()) return; updateDeviceName(nextName); localStorage.setItem('NearFlux_onboarding_complete', 'true'); setIsOpen(false); };

  return (
    <div className="modal-backdrop onboarding-backdrop">
      <div className="modal-card onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-intro"><div className="modal-icon-bg"><Laptop size={18} aria-hidden="true" /></div><div><span className="section-kicker">WELCOME TO NEARFLUX</span><h3 id="onboarding-title">Identify your device</h3><span className="modal-subtitle">Choose how you will appear to friends in your private room.</span></div></div>
        <div className="onboarding-steps" aria-label="How NearFlux works"><div className="onboarding-step active"><span>1</span><strong>Join a room</strong></div><ArrowRight size={14} aria-hidden="true" /><div className="onboarding-step"><span>2</span><strong>Connect</strong></div><ArrowRight size={14} aria-hidden="true" /><div className="onboarding-step"><span>3</span><strong>Send directly</strong></div></div>
        <form onSubmit={(event) => { event.preventDefault(); complete(name); }} className="modal-form"><label htmlFor="onboarding-device-name" className="form-label">Device name</label><div className="input-wrapper"><input id="onboarding-device-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={32} autoFocus autoComplete="name" /><span className="char-counter">{name.length}/32</span></div><span className="form-hint">This name is visible only to people in the same room.</span><div className="modal-actions"><button type="button" className="btn secondary" onClick={() => complete(deviceName)}><RotateCcw size={15} aria-hidden="true" /> Use default</button><button type="submit" className="btn primary" disabled={!name.trim()}><Check size={15} aria-hidden="true" /> Continue</button></div></form>
      </div>
    </div>
  );
};
