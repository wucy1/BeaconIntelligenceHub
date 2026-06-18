import { useEffect, useRef, useState, type FormEvent } from 'react';

import { apiDelete, apiGet, apiPatch } from '../../api';
import {
  CRISIS_TYPES,
  DESCRIPTION_LANGUAGES,
  INFRASTRUCTURE_TYPES,
} from '../../config/questionnaire';
import { useI18n } from '../../i18n/I18nContext';
import { UNSPECIFIED_CRISIS_ID } from '../../constants/crisis';
import { enqueueReport, submitReportOnline } from '../../offline/queue';
import { compressImage } from '../../utils/imageCompress';
import { mediaUrl } from '../../utils/mediaUrl';
import {
  fieldsFromSiteCondition,
  siteConditionFromFields,
  type SiteCondition,
} from '../../utils/siteCondition';
import { AppendixFields } from '../AppendixFields';
import { ApiImage } from '../ApiImage';
import { PhotoPicker } from '../PhotoPicker';
import { SiteConditionField } from './SiteConditionField';

type ReportDetail = {
  id: string;
  crisis_id: string;
  building_id: string | null;
  damage_level: string;
  captured_at_client: string;
  textual_location: string | null;
  infrastructure_types: string[];
  infrastructure_name: string;
  crisis_types: string[];
  debris_clearing_required: boolean;
  description: string;
  description_language: string;
  appendix_answers: Record<string, string | string[]>;
  image_url?: string | null;
};

type Props = {
  open: boolean;
  crisisId: string;
  mode: 'create' | 'edit';
  reportId?: string;
  buildingId: string | null;
  buildingName?: string | null;
  reportGeom?: GeoJSON.Point | null;
  onClose: () => void;
  onSaved: (meta?: { possibleDuplicate?: boolean }) => void;
};

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DEFAULT_APPENDIX: Record<string, string | string[]> = {
  electricity_condition: 'unknown',
  health_services: 'unknown',
  pressing_needs: [],
  pressing_needs_other: '',
};

function defaultDescriptionLang(uiLocale: string): string {
  const codes = DESCRIPTION_LANGUAGES.map((l) => l.code);
  if (codes.includes(uiLocale as (typeof codes)[number])) return uiLocale;
  return 'en';
}

export function ReportSheet({
  open,
  crisisId,
  mode,
  reportId,
  buildingId: initialBuildingId,
  buildingName: initialBuildingName = null,
  reportGeom = null,
  onClose,
  onSaved,
}: Props) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [siteCondition, setSiteCondition] = useState<SiteCondition>('partial');
  const [buildingId, setBuildingId] = useState<string | null>(initialBuildingId);
  const [buildingName, setBuildingName] = useState<string | null>(initialBuildingName);
  const [textualLocation, setTextualLocation] = useState('');
  const [infra, setInfra] = useState<string[]>(['residential']);
  const [infraOther, setInfraOther] = useState('');
  const [infraName, setInfraName] = useState('');
  const [crisisTypes, setCrisisTypes] = useState<string[]>(['earthquake']);
  const [debris, setDebris] = useState(false);
  const [description, setDescription] = useState('');
  const [lang, setLang] = useState(() => defaultDescriptionLang(locale));
  const [capturedAt, setCapturedAt] = useState(toLocalDatetime(new Date().toISOString()));
  const [appendix, setAppendix] = useState<Record<string, string | string[]>>({
    ...DEFAULT_APPENDIX,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editLoadId = useRef<string | null>(null);

  useEffect(() => {
    setBuildingId(initialBuildingId);
    setBuildingName(initialBuildingName);
  }, [initialBuildingId, initialBuildingName]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!open || mode !== 'edit' || !reportId) return;
    if (editLoadId.current === reportId) return;
    editLoadId.current = reportId;
    setLoading(true);
    setError(null);
    setFile(null);
    apiGet<ReportDetail>(`/v1/reports/${reportId}?includeImageUrl=1`)
      .then((r) => {
        setSiteCondition(siteConditionFromFields(r.damage_level, r.appendix_answers));
        setBuildingId(r.building_id);
        setBuildingName(null);
        setTextualLocation(r.textual_location ?? '');
        setInfra(r.infrastructure_types);
        setInfraName(r.infrastructure_name);
        setCrisisTypes(r.crisis_types);
        setDebris(r.debris_clearing_required);
        setDescription(r.description);
        setLang(r.description_language);
        setCapturedAt(toLocalDatetime(r.captured_at_client));
        setAppendix({ ...DEFAULT_APPENDIX, ...r.appendix_answers });
        setPreview(mediaUrl(r.image_url ?? null));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, mode, reportId]);

  useEffect(() => {
    if (open) return;
    editLoadId.current = null;
  }, [open]);

  const toggleIn = (arr: string[], id: string, setter: (v: string[]) => void) => {
    if (arr.includes(id)) setter(arr.filter((x) => x !== id));
    else setter([...arr, id]);
  };

  const buildPayload = (clientUuid: string) => {
    const { damage_level, site_status } = fieldsFromSiteCondition(siteCondition);
    return {
      client_generated_uuid: clientUuid,
      crisis_id: crisisId || UNSPECIFIED_CRISIS_ID,
      building_id: buildingId,
      geom: reportGeom,
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
    if (mode === 'create' && !file) {
      setError(t('report.err.photo'));
      return;
    }
    if (!buildingId && !reportGeom && !textualLocation.trim()) {
      setError(t('report.err.location'));
      return;
    }
    if (infra.includes('other') && !infraOther.trim()) {
      setError(t('report.err.other'));
      return;
    }
    const needs = (appendix.pressing_needs as string[]) ?? [];
    if (needs.includes('other') && !(appendix.pressing_needs_other as string)?.trim()) {
      setError(t('report.err.needsOther'));
      return;
    }

    setSubmitting(true);
    let photo: File | null = null;
    try {
      if (mode === 'edit' && reportId) {
        const { damage_level, site_status } = fieldsFromSiteCondition(siteCondition);
        await apiPatch(`/v1/reports/${reportId}`, {
          building_id: buildingId,
          damage_level,
          infrastructure_types: infra,
          infrastructure_name: infraName.trim() || infraOther.trim() || 'Unnamed',
          crisis_types: crisisTypes,
          debris_clearing_required: debris,
          description,
          description_language: lang,
          captured_at_client: new Date(capturedAt).toISOString(),
          appendix_answers: { ...appendix, site_status },
          textual_location: textualLocation.trim() || null,
        });
        onSaved();
        onClose();
        return;
      }

      const clientUuid = crypto.randomUUID();
      const payload = buildPayload(clientUuid);
      photo = file ? await compressImage(file) : null;
      if (!photo) {
        setError(t('report.err.photo'));
        return;
      }

      if (!navigator.onLine) {
        await enqueueReport(crisisId, payload, photo);
        onSaved();
        onClose();
        return;
      }
      const result = await submitReportOnline(crisisId, payload, photo);
      onSaved({ possibleDuplicate: result.possible_duplicate });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (mode === 'create' && file && !navigator.onLine) {
        try {
          const clientUuid = crypto.randomUUID();
          const uploadId = crisisId || UNSPECIFIED_CRISIS_ID;
          const queued = photo ?? (await compressImage(file));
          await enqueueReport(uploadId, buildPayload(clientUuid), queued);
          onSaved();
          onClose();
        } catch {
          setError(msg);
        }
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!reportId || !confirm(t('map.sheet.deleteConfirm'))) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiDelete(`/v1/reports/${reportId}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="report-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="report-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="report-sheet-header">
          <h2>{mode === 'create' ? t('map.sheet.new') : t('map.sheet.edit')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
            ×
          </button>
        </header>

        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : (
          <form className="report-sheet-form" onSubmit={onSubmit}>
            <section className="form-section form-location-card">
              <h3 className="form-section-title">{t('report.locationTitle')}</h3>
              {buildingName || buildingId ? (
                <p className="form-location-line">
                  <span className="form-location-k">{t('report.selectedBuilding')}</span>
                  <span className="form-location-v">
                    {buildingName ?? buildingId}
                  </span>
                </p>
              ) : (
                <p className="form-location-line muted">{t('map.locationPanel.noBuildingDetected')}</p>
              )}
              {reportGeom && (
                <p className="form-location-line">
                  <span className="form-location-k">{t('map.reportPin')}</span>
                  <span className="form-location-v">
                    {reportGeom.coordinates[1].toFixed(5)}, {reportGeom.coordinates[0].toFixed(5)}
                  </span>
                </p>
              )}
              <p className="form-footprint-note muted">{t('report.footprintNote')}</p>
            </section>

            <section className="form-section">
              <label className="field">
                <span>{t('map.sheet.capturedAt')}</span>
                <input
                  type="datetime-local"
                  value={capturedAt}
                  onChange={(e) => setCapturedAt(e.target.value)}
                />
                {mode === 'create' && (
                  <span className="field-hint muted">{t('report.capturedAtHint')}</span>
                )}
              </label>
            </section>

            {mode === 'create' && (
              <section className="form-section">
                <h3 className="form-section-title">{t('report.photo')}</h3>
                <PhotoPicker onSelect={setFile} />
                {preview && (
                  <ApiImage src={preview} alt="" className="report-sheet-preview" />
                )}
              </section>
            )}
            {mode === 'edit' && preview && (
              <ApiImage src={preview} alt="" className="report-sheet-preview" />
            )}

            <SiteConditionField value={siteCondition} onChange={setSiteCondition} />

            <section className="form-section">
              <h3 className="form-section-title">{t('report.infraTitle')}</h3>
              <div className="chip-group">
                {INFRASTRUCTURE_TYPES.map((opt) => (
                  <label key={opt.id} className={`chip ${infra.includes(opt.id) ? 'chip-active' : ''}`}>
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
              <div className="chip-group">
                {CRISIS_TYPES.map((opt) => (
                  <label key={opt.id} className={`chip ${crisisTypes.includes(opt.id) ? 'chip-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={crisisTypes.includes(opt.id)}
                      onChange={() => toggleIn(crisisTypes, opt.id, setCrisisTypes)}
                    />
                    {t(opt.labelKey)}
                  </label>
                ))}
              </div>
              <label className="field field-check">
                <input type="checkbox" checked={debris} onChange={(e) => setDebris(e.target.checked)} />
                <span>{t('report.debris')}</span>
              </label>
            </section>

            <section className="form-section">
              <AppendixFields values={appendix} onChange={setAppendix} />
              {((appendix.pressing_needs as string[]) ?? []).includes('other') && (
                <label className="field">
                  <span>{t('q.needs.otherSpecify')}</span>
                  <input
                    value={(appendix.pressing_needs_other as string) ?? ''}
                    onChange={(e) => setAppendix({ ...appendix, pressing_needs_other: e.target.value })}
                  />
                </label>
              )}
            </section>

            <section className="form-section">
              <label className="field">
                <span>{t('report.description')}</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={4}
                />
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
            </section>

            {error && <p className="error form-error-banner">{error}</p>}

            <div className="report-sheet-actions">
              {mode === 'edit' && (
                <button type="button" className="danger" onClick={onDelete} disabled={submitting}>
                  {t('map.sheet.delete')}
                </button>
              )}
              <button type="submit" className="primary submit-full" disabled={submitting}>
                {submitting ? t('common.submitting') : t('common.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
