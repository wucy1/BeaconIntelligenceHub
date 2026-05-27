import { useI18n } from '../../i18n/I18nContext';

type Props = {
  buildingName: string | null;
  buildingId: string | null;
  pin: { lat: number; lng: number } | null;
  onOpenForm: () => void;
  onClear: () => void;
  onCancel: () => void;
};

export function PlacementBar({ buildingName, buildingId, pin, onOpenForm, onClear, onCancel }: Props) {
  const { t } = useI18n();

  const summary = buildingName
    ? buildingName
    : buildingId
      ? `${t('report.selectedBuilding')}: ${buildingId.slice(0, 8)}…`
      : pin
        ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`
        : null;

  if (!summary) return null;

  const isCoords = Boolean(pin && !buildingName && !buildingId);

  return (
    <div className="placement-bar">
      <div className="placement-bar-text">
        <span className="placement-bar-label">{t('map.placement.ready')}</span>
        <span className="placement-bar-sep" aria-hidden>
          ·
        </span>
        <span className={`placement-bar-summary${isCoords ? ' placement-bar-coords' : ''}`}>
          {summary}
        </span>
      </div>
      <div className="placement-bar-actions">
        <button type="button" className="ghost small" onClick={onCancel}>
          {t('map.newFlow.cancel')}
        </button>
        <button type="button" className="secondary small" onClick={onClear}>
          {t('map.placement.clear')}
        </button>
        <button type="button" className="primary small" onClick={onOpenForm}>
          {t('map.placement.openForm')}
        </button>
      </div>
    </div>
  );
}
