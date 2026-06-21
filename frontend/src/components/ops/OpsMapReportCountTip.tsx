import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useI18n } from '../../i18n/context';

type Props = {
  primary: string;
  secondary?: string;
  tooltipLines: string[];
};

export function OpsMapReportCountTip({ primary, secondary, tooltipLines }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipId = useId();
  const [pos, setPos] = useState<{ bottom: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(260, window.innerWidth - 16);
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      const pop = document.getElementById(tipId);
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, tipId]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ops-map-report-count ops-map-report-count-btn"
        aria-expanded={open}
        aria-controls={tipId}
        aria-label={t('ops.map.reportCountExpand')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <strong className="ops-map-report-count-primary">{primary}</strong>
        {secondary ? (
          <span className="ops-map-report-count-secondary">{secondary}</span>
        ) : null}
      </button>
      {open && pos
        ? createPortal(
            <div
              id={tipId}
              role="tooltip"
              className="ops-map-report-count-tip"
              style={{
                position: 'fixed',
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                zIndex: 1400,
              }}
            >
              {tooltipLines.map((line, i) => (
                <p key={line} className={i === 0 ? 'ops-map-report-count-tip-primary' : undefined}>
                  {line}
                </p>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
