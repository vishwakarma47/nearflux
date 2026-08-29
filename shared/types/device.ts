export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  os: string;
  browser: string;
  ip?: string;
  joinedAt: number;
}