import { useI18n } from '../../i18n/I18nContext';

export type MapMode = 'all' | 'mine' | 'new';

type Props = {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
};

export function MapModeToggle({ mode, onChange }: Props) {
  const { t } = useI18n();
  const items: { id: MapMode; label: string }[] = [
    { id: 'all', label: t('map.mode.all') },
    { id: 'mine', label: t('map.mode.mine') },
    { id: 'new', label: t('map.mode.new') },
  ];
  return (
    <div className="map-mode-toggle" role="tablist">
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
