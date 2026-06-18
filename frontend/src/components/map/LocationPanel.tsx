import { useEffect, useMemo, useState } from 'react';

import { apiGet } from '../../api';
import type { MapMarker } from './ContributorMap';
import { useI18n } from '../../i18n/I18nContext';
import { normalizeThumbUrl } from '../../utils/mediaUrl';
import {
  chipClassForCondition,
  siteConditionFromFields,
  siteConditionLabelKey,
} from '../../utils/siteCondition';

type ReportSummary = {
  id: string;
  damage_level: string;
  site_status?: string;
  captured_at_client: string;
  description_preview: string;
  building_id: string | null;
  is_mine?: boolean;
  thumb_url?: string | null;
};

export type LocationPanelContext = 'all' | 'mine';

type Props = {
  open: boolean;
  context: LocationPanelContext;
  focusedMarker: MapMarker | null;
  buildingId: string | null;
  buildingName: string | null;
  pin: { lat: number; lng: number } | null;
  nearbyMarkers: MapMarker[];
  onClose: () => void;
  /** Switch to 新增模式並保留位置（不開表單） */
  onAddReportHere: () => void;
  /** 僅編輯自己的既有回報 */
  onEditReport: (reportId: string) => void;
};

export function LocationPanel({
  open,
  context,
  focusedMarker,
  buildingId,
  buildingName,
  pin,
  nearbyMarkers,
  onClose,
  onAddReportHere,
  onEditReport,
}: Props) {
  const { t } = useI18n();
  const [history, setHistory] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setHistory([]);
      setLoading(false);
      return;
    }
    if (!buildingId) return;
    setLoading(true);
    apiGet<ReportSummary[]>(`/v1/buildings/${buildingId}/reports`)
      .then((rows) => {
        const normalized = rows.map(normalizeThumbUrl);
        if (context === 'mine') {
          setHistory(normalized.filter((r) => r.is_mine));
        } else {
          setHistory(normalized);
        }
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [open, buildingId, context]);

  useEffect(() => {
    if (!open || buildingId) return;
    const fromMarkers = nearbyMarkers.map((m) => ({
      id: m.id,
      damage_level: m.damage_level,
      site_status: m.site_status,
      captured_at_client: m.captured_at_client,
      description_preview: '',
      building_id: m.building_id,
      is_mine: m.is_mine,
      thumb_url: m.thumb_url,
    }));
    setLoading(false);
    setHistory(context === 'mine' ? fromMarkers.filter((r) => r.is_mine) : fromMarkers);
  }, [open, buildingId, nearbyMarkers, context]);

  const title = useMemo(() => {
    if (context === 'mine' && focusedMarker?.is_mine) {
      return t('map.locationPanel.titleMine');
    }
    return t('map.locationPanel.titleAll');
  }, [context, focusedMarker, t]);

  if (!open) return null;

  const coordLabel =
    pin != null ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : null;

  const canEditFocused = Boolean(focusedMarker?.is_mine);

  return (
    <div className="location-panel" role="region" aria-label={title}>
      <div className="location-panel-header">
        <h3>{title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
          ×
        </button>
      </div>

      <p className="location-panel-desc muted">{t('map.locationPanel.browseOnly')}</p>

      <div className="location-panel-body">
        {(buildingName || buildingId || coordLabel) && (
          <div className="location-panel-meta">
            {(buildingName || buildingId) && (
              <span className="location-meta-item">
                <span className="location-label">{t('report.selectedBuilding')}</span>
                <strong>{buildingName ?? `${buildingId!.slice(0, 8)}…`}</strong>
              </span>
            )}
            {coordLabel && (
              <span className="location-meta-item location-meta-coords">
                <span className="location-label">{t('map.reportPin')}</span>
                <span className="location-meta-value">{coordLabel}</span>
              </span>
            )}
          </div>
        )}

        {focusedMarker?.thumb_url && (
          <figure className="location-panel-focus-thumb">
            <img
              src={focusedMarker.thumb_url}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </figure>
        )}

        <section className="location-history">
          <h4>{t('map.locationPanel.history')}</h4>
          {loading ? (
            <p className="muted">{t('common.loading')}</p>
          ) : history.length === 0 ? (
            <p className="muted">{t('map.locationPanel.noHistory')}</p>
          ) : (
            <ul className="location-history-list">
              {history.map((r) => {
                const cond = siteConditionFromFields(r.damage_level, {
                  site_status: r.site_status ?? 'affected',
                });
                const pillClass = chipClassForCondition(cond).replace('chip-', 'damage-');
                return (
                <li key={r.id}>
                  {r.thumb_url && (
                    <img
                      src={r.thumb_url}
                      alt=""
                      className="location-history-thumb"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <div className="location-history-row">
                    <span className={`damage-pill ${pillClass}`}>
                      {t(siteConditionLabelKey(cond))}
                    </span>
                    {r.is_mine && <span className="mine-badge">{t('map.mode.mine')}</span>}
                  </div>
                  <time dateTime={r.captured_at_client}>
                    {new Date(r.captured_at_client).toLocaleString()}
                  </time>
                  {r.description_preview && (
                    <span className="location-history-preview">{r.description_preview}</span>
                  )}
                  {r.is_mine && (
                    <button
                      type="button"
                      className="link-btn location-edit-btn"
                      onClick={() => onEditReport(r.id)}
                    >
                      {t('map.locationPanel.editMine')}
                    </button>
                  )}
                </li>
              );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="location-panel-actions">
        {context === 'mine' && canEditFocused && focusedMarker && (
          <button
            type="button"
            className="primary"
            onClick={() => onEditReport(focusedMarker.id)}
          >
            {t('map.locationPanel.editThis')}
          </button>
        )}
        <button type="button" className={context === 'all' ? 'primary' : 'secondary'} onClick={onAddReportHere}>
          {t('map.locationPanel.addHere')}
        </button>
      </div>
    </div>
  );
}
