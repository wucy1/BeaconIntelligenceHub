import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  titleId: string;
  title: string;
  children: ReactNode;
};

export function OpsMapHelpPopover({ open, anchorRef, onClose, titleId, title, children }: Props) {
  const [pos, setPos] = useState<{ bottom: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(288, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({
        bottom: window.innerHeight - r.top + 8,
        left,
        width,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      className="ops-map-help-popover ops-map-help-popover-portal"
      role="dialog"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        bottom: pos.bottom,
        left: pos.left,
        width: pos.width,
        zIndex: 1400,
      }}
    >
      <header className="ops-map-help-popover-header">
        <strong id={titleId}>{title}</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="×">
          ×
        </button>
      </header>
      {children}
    </div>,
    document.body,
  );
}
