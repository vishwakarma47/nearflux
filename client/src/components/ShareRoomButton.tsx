import { Share2 } from 'lucide-react';

interface ShareRoomButtonProps {
  onClick: () => void;
  label: string;
  className?: string;
  iconOnly?: boolean;
}

export const ShareRoomButton: React.FC<ShareRoomButtonProps> = ({ onClick, label, className = '', iconOnly = false }) => (
  <button
    className={`${iconOnly ? 'icon-btn' : 'btn text-btn'} ${className}`.trim()}
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <Share2 size={iconOnly ? 16 : 15} aria-hidden="true" />
    {!iconOnly && label}
  </button>
);
