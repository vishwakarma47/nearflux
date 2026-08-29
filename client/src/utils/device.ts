import { DeviceType } from '../types';

export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (/Mobile|iPhone|iPod|Android|IEMobile|BlackBerry|IEMobile|Kindle/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

export function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.indexOf('Win') !== -1) return 'Windows';
  if (ua.indexOf('Mac') !== -1) return 'macOS';
  if (ua.indexOf('Linux') !== -1) return 'Linux';
  if (ua.indexOf('Android') !== -1) return 'Android';
  if (ua.indexOf('like Mac') !== -1) return 'iOS';
  return 'Unknown OS';
}

export function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.indexOf('Chrome') !== -1 && ua.indexOf('Edg') === -1) return 'Chrome';
  if (ua.indexOf('Safari') !== -1 && ua.indexOf('Chrome') === -1) return 'Safari';
  if (ua.indexOf('Firefox') !== -1) return 'Firefox';
  if (ua.indexOf('Edg') !== -1) return 'Edge';
  return 'Browser';
}

export function getDefaultDeviceName(): string {
  const browser = detectBrowser();
  const os = detectOS();
  const deviceType = detectDeviceType();

  if (deviceType === 'mobile' || deviceType === 'tablet') {
    return `${os} ${deviceType === 'mobile' ? 'Phone' : 'Tablet'}`;
  }
  return `${browser} on ${os}`;
}