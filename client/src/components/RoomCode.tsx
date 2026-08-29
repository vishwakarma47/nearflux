interface RoomCodeProps {
  code?: string;
  className?: string;
}

export const RoomCode: React.FC<RoomCodeProps> = ({ code, className = '' }) => {
  if (!code) return null;
  return <strong className={`room-code ${className}`.trim()}>{code}</strong>;
};
