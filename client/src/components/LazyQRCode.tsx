import { lazy, Suspense } from 'react';

const QRCodeSVG = lazy(async () => {
  const module = await import('qrcode.react');
  return { default: module.QRCodeSVG };
});

interface LazyQRCodeProps {
  value: string;
  size: number;
  bgColor: string;
  fgColor: string;
  level: 'L' | 'M' | 'Q' | 'H';
  includeMargin: boolean;
}

export const LazyQRCode: React.FC<LazyQRCodeProps> = (props) => (
  <Suspense fallback={<div className="qr-loading" role="status" aria-label="Loading room QR code" />}>
    <QRCodeSVG {...props} />
  </Suspense>
);
