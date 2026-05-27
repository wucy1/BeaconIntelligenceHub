import { useI18n } from '../../i18n/I18nContext';
import {
  SITE_CONDITIONS,
  chipClassForCondition,
  type SiteCondition,
} from '../../utils/siteCondition';

type Props = {
  value: SiteCondition;
  onChange: (value: SiteCondition) => void;
};

export function SiteConditionField({ value, onChange }: Props) {
  const { t } = useI18n();

  return (
    <section className="form-section">
      <h3 className="form-section-title">{t('report.siteConditionTitle')}</h3>
      <p className="field-hint muted site-condition-hint">{t('report.siteConditionHint')}</p>
      <div className="chip-group chip-group-radio" role="radiogroup" aria-label={t('report.siteConditionTitle')}>
        {SITE_CONDITIONS.map((c) => (
          <label key={c} className={`chip ${chipClassForCondition(c)} ${value === c ? 'chip-active' : ''}`}>
            <input type="radio" name="siteCondition" checked={value === c} onChange={() => onChange(c)} />
            {c === 'repaired' || c === 'demolished'
              ? t(`report.siteStatus.${c}`)
              : t(`report.damage.${c}`)}
          </label>
        ))}
      </div>
    </section>
  );
}
