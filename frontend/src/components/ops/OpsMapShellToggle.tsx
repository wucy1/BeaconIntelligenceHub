import { useI18n } from '../../i18n/I18nContext';

export type OpsMapShellMode = 'work' | 'view';

type Props = {
  mode: OpsMapShellMode;
  onChange: (mode: OpsMapShellMode) => void;
};

export function OpsMapShellToggle({ mode, onChange }: Props) {
  const { t } = useI18n();
  const items: { id: OpsMapShellMode; label: string }[] = [
    { id: 'work', label: t('ops.map.shell.work') },
    { id: 'view', label: t('ops.map.shell.view') },
  ];
  return (
    <div className="ops-map-shell-toggle map-mode-toggle" role="tablist" aria-label={t('ops.map.shell.label')}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={mode === item.id}
          className={mode === item.id ? 'active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
