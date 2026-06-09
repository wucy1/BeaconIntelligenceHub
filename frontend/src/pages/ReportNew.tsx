import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { apiGet } from '../api';
import { AppendixFields } from '../components/AppendixFields';
import { PhotoPicker } from '../components/PhotoPicker';
import { MapPicker } from '../components/MapPicker';
import {
  CRISIS_TYPES,
  DESCRIPTION_LANGUAGES,
  INFRASTRUCTURE_TYPES,
} from '../config/questionnaire';
import { fieldsFromSiteCondition, type SiteCondition } from '../utils/siteCondition';
import { SiteConditionField } from '../components/map/SiteConditionField';
import { useI18n } from '../i18n/I18nContext';
import { enqueueReport, submitReportOnline } from '../offline/queue';

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReportNew() {
  const { crisisId = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [siteCondition, setSiteCondition] = useState<SiteCondition>('partial');
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [textualLocation, setTextualLocation] = useState('');
  const [infra, setInfra] = useState<string[]>(['residential']);
  const [infraOther, setInfraOther] = useState('');
  const [infraName, setInfraName] = useState('');
  const [crisisTypes, setCrisisTypes] = useState<string[]>(['earthquake']);
  const [debris, setDebris] = useState(false);
  const [description, setDescription] = useState('');
  const [lang, setLang] = useState('en');
  const [capturedAt, setCapturedAt] = useState(toLocalDatetime(new Date().toISOString()));
  const [appendix, setAppendix] = useState<Record<string, string | string[]>>({
    electricity_condition: 'unknown',
    health_services: 'unknown',
    pressing_needs: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const geoMemo = useMemo(
    () => geojson ?? ({ type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection),
    [geojson],
  );

  useEffect(() => {
    apiGet<GeoJSON.FeatureCollection>(`/v1/crises/${crisisId}/buildings`)
      .then(setGeojson)
      .catch((e: Error) => setLoadErr(e.message));
  }, [crisisId]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const toggleIn = (arr: string[], id: string, setter: (v: string[]) => void) => {
    if (arr.includes(id)) setter(arr.filter((x) => x !== id));
    else setter([...arr, id]);
  };

  const onPickMap = useCallback((id: string | null) => setBuildingId(id), []);

  const buildPayload = (clientUuid: string) => {
    const { damage_level, site_status } = fieldsFromSiteCondition(siteCondition);
    return {
      client_generated_uuid: clientUuid,
      crisis_id: crisisId,
      building_id: buildingId,
      geom: null,
      textual_location: textualLocation.trim() || null,
      damage_level,
      infrastructure_types: infra,
      infrastructure_name: infraName.trim() || infraOther.trim() || 'Unnamed',
      crisis_types: crisisTypes,
      debris_clearing_required: debris,
      description,
      description_language: lang,
      captured_at_client: new Date(capturedAt).toISOString(),
      appendix_answers: { ...appendix, site_status },
    };
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!file) {
      setError(t('report.err.photo'));
      return;
    }
    if (!buildingId && !textualLocation.trim()) {
      setError(t('report.err.location'));
      return;
    }
    if (infra.includes('other') && !infraOther.trim()) {
      setError(t('report.err.other'));
      return;
    }

    setSubmitting(true);
    const clientUuid = crypto.randomUUID();
    const payload = buildPayload(clientUuid);
    try {
      if (!navigator.onLine) {
        await enqueueReport(crisisId, payload, file);
        setSuccess(t('report.offlineQueued'));
        setTimeout(() => navigate('/'), 1500);
        return;
      }
      await submitReportOnline(crisisId, payload, file);
      setSuccess(t('report.success'));
      setTimeout(() => navigate('/'), 800);
    } catch (err) {
      if (!navigator.onLine) {
        try {
          await enqueueReport(crisisId, payload, file);
          setSuccess(t('report.offlineQueued'));
          setTimeout(() => navigate('/'), 1500);
        } catch {
          setError(err instanceof Error ? err.message : String(err));
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadErr) {
    return (
      <section className="card">
        <p className="error">{loadErr}</p>
        <Link to="/">{t('common.back')}</Link>
      </section>
    );
  }
  if (!geojson) return <p>{t('common.loading')}</p>;

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>{t('report.title')}</h1>
      <p className="muted">
        {t('report.crisisId')}: <code>{crisisId}</code>
      </p>

      <section className="form-section">
        <h3 className="form-section-title">{t('report.photo')}</h3>
        <PhotoPicker onSelect={setFile} />
      </section>
      {preview && <img src={preview} alt="preview" style={{ maxWidth: '100%', borderRadius: 8 }} />}

      <SiteConditionField value={siteCondition} onChange={setSiteCondition} />

      <h2>{t('report.locationTitle')}</h2>
      <MapPicker geojson={geoMemo} value={buildingId} onChange={onPickMap} />
      <p className="muted">
        {t('report.selectedBuilding')}: {buildingId ?? t('report.noneSelected')}
      </p>

      <label className="field">
        <span>{t('map.sheet.capturedAt')}</span>
        <input
          type="datetime-local"
          value={capturedAt}
          onChange={(e) => setCapturedAt(e.target.value)}
        />
        <span className="field-hint muted">{t('report.capturedAtHint')}</span>
      </label>

      <h2>{t('report.infraTitle')}</h2>
      <div className="grid">
        {INFRASTRUCTURE_TYPES.map((opt) => (
          <label key={opt.id}>
            <input
              type="checkbox"
              checked={infra.includes(opt.id)}
              onChange={() => toggleIn(infra, opt.id, setInfra)}
            />
            {t(opt.labelKey)}
          </label>
        ))}
      </div>
      {infra.includes('other') && (
        <label className="field">
          <span>{t('report.otherSpecify')}</span>
          <input value={infraOther} onChange={(e) => setInfraOther(e.target.value)} />
        </label>
      )}

      <label className="field">
        <span>{t('report.infraName')}</span>
        <span className="field-hint muted">{t('report.infraNameHint')}</span>
        <input value={infraName} onChange={(e) => setInfraName(e.target.value)} required />
      </label>

      <label className="field">
        <span>{t('report.textLocation')}</span>
        <span className="field-hint muted">{t('report.textLocationHint')}</span>
        <input
          value={textualLocation}
          onChange={(e) => setTextualLocation(e.target.value)}
          placeholder={t('report.textLocationPlaceholder')}
        />
      </label>

      <div className="grid">
        {CRISIS_TYPES.map((opt) => (
          <label key={opt.id}>
            <input
              type="checkbox"
              checked={crisisTypes.includes(opt.id)}
              onChange={() => toggleIn(crisisTypes, opt.id, setCrisisTypes)}
            />
            {t(opt.labelKey)}
          </label>
        ))}
      </div>

      <label className="field">
        <input type="checkbox" checked={debris} onChange={(e) => setDebris(e.target.checked)} />
        {t('report.debris')}
      </label>

      <h2>{t('report.appendixTitle')}</h2>
      <AppendixFields values={appendix} onChange={setAppendix} />

      <label className="field">
        <span>{t('report.description')}</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} />
      </label>

      <label className="field">
        <span>{t('report.descriptionLang')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {DESCRIPTION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {t(l.labelKey)}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      <div className="actions">
        <button type="submit" disabled={submitting}>
          {submitting ? t('common.submitting') : t('common.submit')}
        </button>
        <Link to="/">{t('common.cancel')}</Link>
      </div>
    </form>
  );
}

