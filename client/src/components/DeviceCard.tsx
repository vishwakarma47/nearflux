import React from 'react';
import { Smartphone, Tablet, Laptop, Check, Circle } from 'lucide-react';
import { Device } from '../types/index.js';

interface DeviceCardProps {
  device: Device;
  isSelected: boolean;
  onSelect: (device: Device) => void;
}

export const DeviceCard = React.memo<DeviceCardProps>(({ device, isSelected, onSelect }) => {
  const getDeviceIcon = () => {
    switch (device.type) {
      case 'mobile': return <Smartphone size={25} strokeWidth={1.8} />;
      case 'tablet': return <Tablet size={25} strokeWidth={1.8} />;
      default: return <Laptop size={25} strokeWidth={1.8} />;
    }
  };

  return (
    <button className={`device-card ${isSelected ? 'selected' : ''}`} type="button" aria-pressed={isSelected} aria-label={`${isSelected ? 'Deselect' : 'Select'} ${device.name} for direct transfer`} onClick={() => onSelect(device)}>
      <span className="device-avatar" aria-hidden="true">{getDeviceIcon()}<span className="online-indicator pulse-dot" /></span>
      <span className="device-info">
        <span className="device-card-name" title={device.name}>{device.name}</span>
        <span className="device-card-sub">{device.os} <span aria-hidden="true">·</span> {device.browser}</span>
        <span className="device-card-status"><Circle size={7} fill="currentColor" aria-hidden="true" /> Online</span>
      </span>
      <span className={`checkbox-indicator ${isSelected ? 'checked' : ''}`} aria-hidden="true">{isSelected && <Check size={14} strokeWidth={2.5} />}</span>
    </button>
  );
});

DeviceCard.displayName = 'DeviceCard';
