import { useEffect, useRef, useState } from 'react';

import { apiGet } from '../../api';
import { useI18n } from '../../i18n/I18nContext';
import { usePreferCollapsedChrome } from '../../hooks/usePreferCollapsedChrome';

type Contribution = {
  crisis_id: string;
  report_count: number;
  distinct_locations: number;
  possible_duplicate_recent: number;
};

type Props = {
  crisisId: string;
  /** 面板已開啟 */
  visible: boolean;
  /** 可呼叫 API（連線且非新增模式） */
  fetchable?: boolean;
  refreshKey?: number;
  embedded?: boolean;
};

export function ContributionStrip({
  crisisId,
  visible,
  fetchable = true,
  refreshKey = 0,
  embedded = false,
}: Props) {
  const { t } = useI18n();
  const preferCollapsed = usePreferCollapsedChrome();
  const [stats, setStats] = useState<Contribution | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!visible || !crisisId || !fetchable) {
      if (!visible) setStats(null);
      return;
    }
    apiGet<Contribution>('/v1/public/my-contribution')
      .then(setStats)
      .catch(() => setStats(null));
  }, [visible, fetchable, crisisId, refreshKey]);

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = !preferCollapsed;
    }
  }, [preferCollapsed, visible]);

  if (!visible) return null;

  const summaryLabel =
    stats && stats.report_count > 0
      ? t('contribution.statsShort', {
          count: stats.report_count,
          places: stats.distinct_locations,
        })
      : t('contribution.summaryCollapsed');

  const statsBody = !fetchable ? (
    <p className="contribution-strip-stats muted">{t('contribution.offlineHint')}</p>
  ) : stats && stats.report_count > 0 ? (
    <p className="contribution-strip-stats">
      {t('contribution.stats', {
        count: stats.report_count,
        places: stats.distinct_locations,
      })}
    </p>
  ) : (
    <p className="contribution-strip-stats muted">{t('contribution.empty')}</p>
  );

  if (embedded) {
    return (
      <div className="contribution-strip contribution-strip-embedded" aria-live="polite">
        <div className="contribution-strip-body">
          <p className="contribution-strip-mission">{t('contribution.mission')}</p>
          {statsBody}
          <p className="contribution-strip-note muted">{t('contribution.noLeaderboard')}</p>
          <p className="contribution-strip-note muted">{t('contribution.scopeHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <details ref={detailsRef} className="contribution-strip map-chrome-collapsible" aria-live="polite">
      <summary className="map-chrome-summary contribution-strip-summary">{summaryLabel}</summary>
      <div className="contribution-strip-body">
        <p className="contribution-strip-mission">{t('contribution.mission')}</p>
        {statsBody}
        <p className="contribution-strip-note muted">{t('contribution.noLeaderboard')}</p>
      </div>
    </details>
  );
}
