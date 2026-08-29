import { useState } from 'react';
import { getDefaultDeviceName } from '../utils/device';

export function useDeviceName() {
  const [deviceName, setDeviceName] = useState<string>(() => {
    const saved = localStorage.getItem('NearFlux_device_name');
    return saved || getDefaultDeviceName();
  });

  const updateName = (newName: string) => {
    const trimmed = newName.trim();
    if (trimmed) {
      setDeviceName(trimmed);
      localStorage.setItem('NearFlux_device_name', trimmed);
    }
  };

  return { deviceName, updateName };
}