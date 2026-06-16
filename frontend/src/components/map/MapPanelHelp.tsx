import { useId, useRef, useState, type ReactNode } from 'react';

import { OpsMapHelpPopover } from '../ops/OpsMapHelpPopover';

type Props = {
  title: string;
  children: ReactNode;
};

export function MapPanelHelp({ title, children }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ops-map-help-btn map-panel-help-btn"
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      <OpsMapHelpPopover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        titleId={titleId}
        title={title}
      >
        {children}
      </OpsMapHelpPopover>
    </>
  );
}
