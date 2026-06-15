import { useEffect, useId, useRef, useState } from 'react';

import { useI18n } from '../../i18n/I18nContext';

type Props = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

function splitLocalValue(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '00:00' };
  const [date, time] = value.split('T');
  return { date: date ?? '', time: (time ?? '00:00').slice(0, 5) };
}

function joinLocalValue(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
}

function formatDisplay(value: string, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OpsDatetimeField({ value, onChange, className, disabled }: Props) {
  const { t, locale } = useI18n();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('00:00');

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    const parts = splitLocalValue(value);
    setDraftDate(parts.date);
    setDraftTime(parts.time);
    setOpen(true);
  };

  const confirm = () => {
    onChange(joinLocalValue(draftDate, draftTime));
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`ops-datetime-field ${className ?? ''}`.trim()}>
      <button
        type="button"
        className="ops-datetime-trigger"
        onClick={openPicker}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-popover`}
      >
        {formatDisplay(value, locale)}
      </button>
      {open && (
        <div id={`${id}-popover`} className="ops-datetime-popover" role="dialog" aria-label={t('ops.datetime.title')}>
          <label className="ops-datetime-popover-row">
            <span>{t('ops.datetime.date')}</span>
            <input type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
          </label>
          <label className="ops-datetime-popover-row">
            <span>{t('ops.datetime.time')}</span>
            <input type="time" value={draftTime} onChange={(e) => setDraftTime(e.target.value)} />
          </label>
          <div className="ops-datetime-popover-actions">
            <button type="button" className="small secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="small secondary" onClick={clear}>
              {t('ops.datetime.clear')}
            </button>
            <button type="button" className="small" onClick={confirm} disabled={!draftDate}>
              {t('common.confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
