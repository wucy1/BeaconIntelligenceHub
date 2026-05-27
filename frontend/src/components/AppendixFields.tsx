import {
  APPENDIX_SECTIONS,
  type AppendixField,
  type OptionDef,
} from '../config/questionnaire';
import { useI18n } from '../i18n/I18nContext';

type Values = Record<string, string | string[]>;

type Props = {
  values: Values;
  onChange: (values: Values) => void;
};

export function AppendixFields({ values, onChange }: Props) {
  const { t } = useI18n();

  const setField = (key: string, value: string | string[]) => {
    onChange({ ...values, [key]: value });
  };

  const toggleMulti = (key: string, id: string) => {
    const cur = (values[key] as string[] | undefined) ?? [];
    if (cur.includes(id)) setField(key, cur.filter((x) => x !== id));
    else setField(key, [...cur, id]);
  };

  const renderField = (field: AppendixField) => {
    if (field.type === 'select') {
      return (
        <label key={field.key} className="field">
          <span>{t(field.labelKey)}</span>
          <select
            value={(values[field.key] as string) ?? 'unknown'}
            onChange={(e) => setField(field.key, e.target.value)}
          >
            {field.options.map((o: OptionDef) => (
              <option key={o.id} value={o.id}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <div key={field.key}>
        <p className="muted">{t(field.labelKey)}</p>
        <div className="grid">
          {field.options.map((o: OptionDef) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={((values[field.key] as string[]) ?? []).includes(o.id)}
                onChange={() => toggleMulti(field.key, o.id)}
              />
              {t(o.labelKey)}
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      {APPENDIX_SECTIONS.map((section) => (
        <fieldset key={section.id}>
          <legend>{t(section.titleKey)}</legend>
          {section.fields.map(renderField)}
        </fieldset>
      ))}
    </>
  );
}
