import { useEffect, useRef } from 'react';

import { useI18n } from '../../i18n/I18nContext';
import { usePreferCollapsedChrome } from '../../hooks/usePreferCollapsedChrome';

const DAMAGE_ITEMS = [
  { color: '#22c55e', key: 'map.legend.minimal' },
  { color: '#f59e0b', key: 'map.legend.partial' },
  { color: '#ef4444', key: 'map.legend.complete' },
] as const;

const STATUS_ITEMS = [
  { color: '#0ea5e9', key: 'map.legend.repaired' },
  { color: '#64748b', key: 'map.legend.demolished' },
] as const;

type Props = {
  buildingCount: number;
  buildingsLoading?: boolean;
  buildingsError?: string | null;
  markerCount: number;
  mode: string;
  embedded?: boolean;
  /** 滾動顯示月數（併入圖例） */
  reportWindowMonths?: number | null;
  onFlyToDemoFootprints?: () => void;
};

function BuildingsLegendRows({
  buildingCount,
  buildingsLoading,
  buildingsError,
  onFlyToDemoFootprints,
}: Pick<Props, 'buildingCount' | 'buildingsLoading' | 'buildingsError' | 'onFlyToDemoFootprints'>) {
  const { t } = useI18n();

  return (
    <>
      <div className="map-legend-row">
        <span className="map-legend-swatch building" />
        <span>
          {buildingsLoading
            ? t('map.legend.buildingsLoading')
            : t('map.legend.buildings', { count: buildingCount })}
        </span>
      </div>
      <p className="map-legend-footnote muted">{t('map.legend.footprintVisualHint')}</p>
      {buildingsError && (
        <p className="map-legend-footnote map-legend-footnote-warn">{t('map.err.buildingsLoad', { msg: buildingsError })}</p>
      )}
      {buildingCount > 0 ? (
        <p className="map-legend-footnote muted">{t('map.legend.footprintNote')}</p>
      ) : !buildingsLoading ? (
        <>
          <p className="map-legend-footnote muted">{t('map.legend.noBuildingsHint')}</p>
          {onFlyToDemoFootprints && (
            <button type="button" className="map-legend-fly-btn" onClick={onFlyToDemoFootprints}>
              {t('map.legend.flyToDemoFootprints')}
            </button>
          )}
        </>
      ) : null}
    </>
  );
}

export function MapLegend({
  buildingCount,
  buildingsLoading = false,
  buildingsError = null,
  markerCount,
  mode,
  embedded = false,
  reportWindowMonths = null,
  onFlyToDemoFootprints,
}: Props) {
  const { t } = useI18n();
  const preferCollapsed = usePreferCollapsedChrome();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = !preferCollapsed;
    }
  }, [preferCollapsed]);

  const buildingRows = (
    <BuildingsLegendRows
      buildingCount={buildingCount}
      buildingsLoading={buildingsLoading}
      buildingsError={buildingsError}
      onFlyToDemoFootprints={onFlyToDemoFootprints}
    />
  );

  if (embedded) {
    return (
      <div className="map-legend map-legend-embedded">
        <div className="map-legend-body">
          <div className="map-legend-row map-legend-title-row">
            <strong>{t('map.legend.title')}</strong>
          </div>
          {buildingRows}
          {reportWindowMonths != null && mode !== 'new' && (
            <div className="map-legend-row">
              <span>{t('map.window.recentMonths', { months: reportWindowMonths })}</span>
            </div>
          )}
          {mode !== 'new' && (
            <div className="map-legend-row">
              <span>{t('map.legend.reports', { count: markerCount })}</span>
            </div>
          )}
          {DAMAGE_ITEMS.map((item) => (
            <div key={item.key} className="map-legend-row">
              <span className="map-legend-swatch" style={{ background: item.color }} />
              <span>{t(item.key)}</span>
            </div>
          ))}
          {STATUS_ITEMS.map((item) => (
            <div key={item.key} className="map-legend-row">
              <span className="map-legend-swatch" style={{ background: item.color }} />
              <span>{t(item.key)}</span>
            </div>
          ))}
          <p className="map-legend-footnote muted">{t('map.legend.clusterNote')}</p>
        </div>
      </div>
    );
  }

  return (
    <details ref={detailsRef} className="map-legend map-chrome-collapsible">
      <summary className="map-chrome-summary">{t('map.legend.title')}</summary>
      <div className="map-legend-body">
        <div className="map-legend-row map-legend-title-row">
          <strong>{t('map.legend.title')}</strong>
        </div>
        {buildingRows}
        {reportWindowMonths != null && mode !== 'new' && (
          <div className="map-legend-row">
            <span>{t('map.window.recentMonths', { months: reportWindowMonths })}</span>
          </div>
        )}
        {mode !== 'new' && (
          <div className="map-legend-row">
            <span>{t('map.legend.reports', { count: markerCount })}</span>
          </div>
        )}
        {DAMAGE_ITEMS.map((item) => (
          <div key={item.key} className="map-legend-row">
            <span className="map-legend-swatch" style={{ background: item.color }} />
            <span>{t(item.key)}</span>
          </div>
        ))}
        {STATUS_ITEMS.map((item) => (
          <div key={item.key} className="map-legend-row">
            <span className="map-legend-swatch" style={{ background: item.color }} />
            <span>{t(item.key)}</span>
          </div>
        ))}
        <p className="map-legend-footnote muted">{t('map.legend.clusterNote')}</p>
      </div>
    </details>
  );
}
