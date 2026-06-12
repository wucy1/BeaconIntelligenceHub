import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { apiGet, wakeApiBackend } from '../api';
import { useI18n } from '../i18n/I18nContext';
import { CrisisMetaFields, type CrisisMetaDraft } from '../components/ops/CrisisMetaFields';
import {
  opsDelete,
  opsGet,
  opsPatch,
  opsPost,
  type AuditEntry,
  type OpsCrisis,
  type OpsUserRecord,
  type OpsZone,
} from '../ops/opsApi';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../ops/polygonUtils';
import {
  getOpsUser,
  opsCanAssignCoordinator,
  opsIsCrisisLead,
  opsIsSystemAdmin,
} from '../ops/opsAuth';
import { isManageableCrisis, isUnspecifiedCrisis } from '../ops/crisisUtils';
import { readOpsCrisesCache, readOpsZonesCache, writeOpsCrisesCache, writeOpsZonesCache } from '../ops/opsCache';
import { isOpsDemoHosting, setOpsDemoHostingHint } from '../ops/opsHosting';
import { OpsTabs } from '../components/ops/OpsTabs';

type OpsTabId = 'overview' | 'crises' | 'create-crisis' | 'team' | 'audit';

function roleLabel(role: string, t: (key: string) => string): string {
  if (role === 'system_admin') return t('ops.role.systemAdmin');
  return t('ops.role.coordinator');
}

function pickCrisisId(prev: string, items: OpsCrisis[]): string {
  if (prev && items.some((c) => c.id === prev)) return prev;
  return items[0]?.id ?? '';
}

export function OpsDashboard() {
  const { t, crisisName } = useI18n();
  const user = getOpsUser();
  const isAdmin = opsIsSystemAdmin(user);
  const demoHosting = isOpsDemoHosting();

  const [crises, setCrises] = useState<OpsCrisis[]>(() => readOpsCrisesCache() ?? []);
  const [zones, setZones] = useState<OpsZone[]>(() => readOpsZonesCache() ?? []);
  const [opsUsers, setOpsUsers] = useState<OpsUserRecord[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<Array<{ id: string; email: string }>>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [selectedCrisisId, setSelectedCrisisId] = useState('');
  const [newCrisisSlug, setNewCrisisSlug] = useState('');
  const [newCrisisName, setNewCrisisName] = useState('');
  const [newCrisisMeta, setNewCrisisMeta] = useState<CrisisMetaDraft>({
    archive_status: 'draft',
    event_start: '',
    event_end: '',
  });
  const [editCrisisMeta, setEditCrisisMeta] = useState<CrisisMetaDraft>({
    archive_status: 'draft',
    event_start: '',
    event_end: '',
  });
  const [crisisEditMsg, setCrisisEditMsg] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'coordinator' | 'system_admin'>('coordinator');
  const [resetPwdUser, setResetPwdUser] = useState<OpsUserRecord | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [assignLeadUserId, setAssignLeadUserId] = useState('');
  const [assignLeadCrisisId, setAssignLeadCrisisId] = useState('');
  const [assignCoordCrisisId, setAssignCoordCrisisId] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignZoneId, setAssignZoneId] = useState('');

  const [apiBanner, setApiBanner] = useState<string | null>(null);
  const [apiWaking, setApiWaking] = useState(false);
  const [crisisFormMsg, setCrisisFormMsg] = useState<string | null>(null);
  const [userFormMsg, setUserFormMsg] = useState<string | null>(null);
  const [leadFormMsg, setLeadFormMsg] = useState<string | null>(null);
  const [coordFormMsg, setCoordFormMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<OpsTabId>('overview');

  const selectedCrisis = crises.find((c) => c.id === selectedCrisisId) ?? null;
  const assignLeadCrisis = crises.find((c) => c.id === assignLeadCrisisId) ?? null;
  const coordCrisisId = assignCoordCrisisId || selectedCrisisId;
  const crisisZones = zones.filter((z) => z.crisis_id === coordCrisisId);
  const canAssignCoord = selectedCrisisId ? opsCanAssignCoordinator(user, selectedCrisisId) : false;
  const isLeadForSelected = selectedCrisisId ? opsIsCrisisLead(user, selectedCrisisId) : false;

  const loadCrises = useCallback(async () => {
    try {
      const d = await opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises');
      setCrises(d.items);
      writeOpsCrisesCache(d.items);
      setSelectedCrisisId((prev) => pickCrisisId(prev, d.items));
      setAssignLeadCrisisId((prev) => pickCrisisId(prev, d.items));
      setAssignCoordCrisisId((prev) => pickCrisisId(prev, d.items));
      setApiBanner(null);
    } catch (e) {
      const cached = readOpsCrisesCache();
      if (cached?.length) {
        setCrises(cached);
        setSelectedCrisisId((prev) => pickCrisisId(prev, cached));
      } else {
        setCrises([]);
      }
      setApiBanner(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadZones = useCallback(() => {
    opsGet<{ items: OpsZone[] }>('/v1/ops/zones')
      .then((d) => {
        setZones(d.items);
        writeOpsZonesCache(d.items);
      })
      .catch(() => {
        const cached = readOpsZonesCache();
        if (cached) setZones(cached);
        else setZones([]);
      });
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const d = await opsGet<{ items: OpsUserRecord[] }>('/v1/ops/users');
      setOpsUsers(d.items);
    } catch {
      setOpsUsers([]);
    }
  }, [isAdmin]);

  const loadAssignableUsers = useCallback(() => {
    if (!isAdmin && !isLeadForSelected) return;
    opsGet<{ items: Array<{ id: string; email: string }> }>('/v1/ops/users/assignable')
      .then((d) => setAssignableUsers(d.items))
      .catch(() => setAssignableUsers([]));
  }, [isAdmin, isLeadForSelected]);

  const loadAudit = useCallback(() => {
    if (!isAdmin) return;
    opsGet<{ items: AuditEntry[] }>('/v1/ops/audit-log?limit=20')
      .then((d) => setAudit(d.items))
      .catch(() => setAudit([]));
  }, [isAdmin]);

  const reloadAll = useCallback(async (opts?: { background?: boolean }) => {
    const hasCache = Boolean(readOpsCrisesCache()?.length);
    if (!opts?.background) {
      setApiWaking(!hasCache);
    }
    setApiBanner(null);
    if (!hasCache) {
      await wakeApiBackend();
    }
    await loadCrises();
    loadZones();
    await loadUsers();
    loadAudit();
    setApiWaking(false);
  }, [loadCrises, loadZones, loadUsers, loadAudit]);

  useEffect(() => {
    const hasCache = Boolean(readOpsCrisesCache()?.length);
    void reloadAll({ background: hasCache });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiGet<{ show_demo_cold_start_hint?: boolean }>('/v1/public/settings')
      .then((s) => {
        if (typeof s.show_demo_cold_start_hint === 'boolean') {
          setOpsDemoHostingHint(s.show_demo_cold_start_hint);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadAssignableUsers();
  }, [loadAssignableUsers, selectedCrisisId]);

  useEffect(() => {
    if (!selectedCrisis) return;
    setEditCrisisMeta({
      archive_status: selectedCrisis.archive_status,
      event_start: toDatetimeLocalValue(selectedCrisis.archive_window_start),
      event_end: toDatetimeLocalValue(selectedCrisis.archive_window_end),
    });
    setCrisisEditMsg(null);
  }, [selectedCrisis]);

  const crisisMetaLabels = useMemo(
    () => ({
      status: t('ops.crisis.status'),
      eventStart: t('ops.crisis.eventStart'),
      eventEnd: t('ops.crisis.eventEnd'),
      eventHint: t('ops.crisis.eventHint'),
      statusDraft: t('ops.crisis.statusDraft'),
      statusActive: t('ops.crisis.statusActive'),
      statusArchived: t('ops.crisis.statusArchived'),
    }),
    [t],
  );

  if (!user) return <Navigate to="/ops/login" replace />;

  const canEditSelectedCrisis = isAdmin || isLeadForSelected;

  const createCrisis = async () => {
    if (!isAdmin) {
      setCrisisFormMsg('僅系統管理員可建立危機');
      return;
    }
    if (!newCrisisSlug.trim() || !newCrisisName.trim()) {
      setCrisisFormMsg('請填寫 slug 與名稱');
      return;
    }
    setBusy(true);
    setApiBanner(null);
    setCrisisFormMsg(null);
    try {
      const c = await opsPost<OpsCrisis>('/v1/ops/crises', {
        slug: newCrisisSlug.trim(),
        name: { 'zh-Hant': newCrisisName.trim(), zh: newCrisisName.trim() },
        archive_status: newCrisisMeta.archive_status,
        archive_window_start: fromDatetimeLocalValue(newCrisisMeta.event_start),
        archive_window_end: fromDatetimeLocalValue(newCrisisMeta.event_end),
      });
      setCrises((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
      setSelectedCrisisId(c.id);
      setNewCrisisSlug('');
      setNewCrisisName('');
      setNewCrisisMeta({ archive_status: 'draft', event_start: '', event_end: '' });
      setCrisisFormMsg(`已建立「${crisisName(c.name, c.slug)}」`);
      setActiveTab('crises');
      await loadCrises();
      loadAudit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCrisisFormMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedCrisisMeta = async () => {
    if (!selectedCrisisId || !canEditSelectedCrisis) return;
    setBusy(true);
    setCrisisEditMsg(null);
    try {
      const updated = await opsPatch<OpsCrisis>(`/v1/ops/crises/${selectedCrisisId}`, {
        archive_status: editCrisisMeta.archive_status,
        archive_window_start: fromDatetimeLocalValue(editCrisisMeta.event_start),
        archive_window_end: fromDatetimeLocalValue(editCrisisMeta.event_end),
      });
      setCrises((prev) => {
        const next = prev.map((c) => (c.id === updated.id ? updated : c));
        writeOpsCrisesCache(next);
        return next;
      });
      setCrisisEditMsg(t('ops.crisis.saved'));
      loadAudit();
    } catch (e) {
      setCrisisEditMsg(e instanceof Error ? e.message : t('ops.crisis.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    if (!newUserEmail.trim() || newUserPassword.length < 8) {
      setUserFormMsg(t('ops.team.needUserFields'));
      return;
    }
    setBusy(true);
    setUserFormMsg(null);
    try {
      const created = await opsPost<OpsUserRecord>('/v1/ops/users', {
        email: newUserEmail.trim().toLowerCase(),
        password: newUserPassword,
        display_name: newUserName.trim() || null,
        role: newUserRole,
      });
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      setOpsUsers((prev) => (prev.some((u) => u.id === created.id) ? prev : [...prev, created]));
      setUserFormMsg(t('ops.team.userCreated', { email: created.email }));
      await loadUsers();
      loadAudit();
    } catch (e) {
      setUserFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignCrisisLead = async () => {
    if (!assignLeadUserId || !assignLeadCrisisId) {
      setLeadFormMsg(t('ops.team.pickLead'));
      return;
    }
    setBusy(true);
    setLeadFormMsg(null);
    const leadEmail = opsUsers.find((u) => u.id === assignLeadUserId)?.email;
    const crisisTitle = assignLeadCrisis ? crisisName(assignLeadCrisis.name, assignLeadCrisis.slug) : '';
    try {
      await opsPost(`/v1/ops/users/${assignLeadUserId}/crises/${assignLeadCrisisId}`, {});
      setAssignLeadUserId('');
      setLeadFormMsg(t('ops.team.leadAssigned', { email: leadEmail ?? '', crisis: crisisTitle }));
      await loadUsers();
      loadAudit();
    } catch (e) {
      setLeadFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignZoneToUser = async () => {
    if (!assignUserId || !assignZoneId) {
      setCoordFormMsg(t('ops.team.pickCoord'));
      return;
    }
    setBusy(true);
    setCoordFormMsg(null);
    try {
      await opsPost(`/v1/ops/users/${assignUserId}/zones/${assignZoneId}`, {
        assignment_role: 'coordinator',
      });
      setCoordFormMsg(t('ops.team.coordAssigned'));
      await loadUsers();
      loadAudit();
    } catch (e) {
      setCoordFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unassignCrisisLead = async (userId: string, crisisId: string) => {
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/users/${userId}/crises/${crisisId}`);
      await loadUsers();
      loadAudit();
    } catch (e) {
      setLeadFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetUserPassword = async () => {
    if (!resetPwdUser) return;
    const password = resetPwdValue.trim();
    if (password.length < 8) {
      setUserFormMsg(t('ops.team.needUserFields'));
      return;
    }
    setBusy(true);
    setUserFormMsg(null);
    try {
      await opsPatch(`/v1/ops/users/${resetPwdUser.id}`, { password });
      setResetPwdUser(null);
      setResetPwdValue('');
      setUserFormMsg(t('ops.team.passwordResetFor', { email: resetPwdUser.email }));
      loadAudit();
    } catch (e) {
      setUserFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unassignZone = async (userId: string, zoneId: string) => {
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/users/${userId}/zones/${zoneId}`);
      await loadUsers();
      loadAudit();
    } catch (e) {
      setCoordFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const manageableCrises = useMemo(() => crises.filter(isManageableCrisis), [crises]);
  const coordAssignableCrises = useMemo(
    () => manageableCrises.filter((c) => opsCanAssignCoordinator(user, c.id)),
    [manageableCrises, user],
  );

  const workflowSteps = isAdmin
    ? [
        t('ops.workflow.admin.1'),
        t('ops.workflow.admin.2'),
        t('ops.workflow.admin.3'),
        t('ops.workflow.admin.4'),
        t('ops.workflow.admin.5'),
      ]
    : isLeadForSelected
      ? [
          t('ops.workflow.lead.1'),
          t('ops.workflow.lead.2'),
          t('ops.workflow.lead.3'),
          t('ops.workflow.lead.4'),
        ]
      : [t('ops.workflow.coord.1'), t('ops.workflow.coord.2')];

  const tabs = useMemo(() => {
    const items: Array<{ id: OpsTabId; label: string }> = [
      { id: 'overview', label: t('ops.tab.overview') },
      { id: 'crises', label: t('ops.tab.crises') },
    ];
    if (isAdmin) items.push({ id: 'create-crisis', label: t('ops.tab.createCrisis') });
    if (isAdmin || canAssignCoord) items.push({ id: 'team', label: t('ops.tab.team') });
    if (isAdmin) items.push({ id: 'audit', label: t('ops.tab.audit') });
    return items;
  }, [isAdmin, canAssignCoord, t]);

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab('overview');
  }, [tabs, activeTab]);

  return (
    <section className="card ops-dashboard">
      <header className="ops-dash-header">
        <div>
          <h1>{t('ops.console.title')}</h1>
          <p className="muted">
            {user.email} · {roleLabel(user.role, t)}
            {user.crisis_lead_assignments && user.crisis_lead_assignments.length > 0 && (
              <> · {t('ops.console.leadCount', { count: user.crisis_lead_assignments.length })}</>
            )}
          </p>
        </div>
      </header>

      {(apiWaking || apiBanner) && (
        <div className={`ops-api-banner${apiBanner ? ' ops-api-banner-error' : ''}`}>
          {apiWaking && !apiBanner && (
            <>
              <p>{t('ops.coldStart.waking')}</p>
              {demoHosting && (
                <p className="muted ops-cold-start-detail">{t('ops.coldStart.demoHint')}</p>
              )}
            </>
          )}
          {apiBanner && (
            <>
              <p>{apiBanner}</p>
              {demoHosting && (
                <p className="muted ops-cold-start-detail">{t('ops.coldStart.demoDetail')}</p>
              )}
              <button type="button" className="secondary" onClick={() => void reloadAll()} disabled={apiWaking}>
                {t('ops.coldStart.reconnect')}
              </button>
            </>
          )}
        </div>
      )}

      <OpsTabs tabs={tabs} active={activeTab} onChange={(id) => setActiveTab(id as OpsTabId)} />

      {activeTab === 'overview' && (
        <section className="ops-dash-section ops-dash-workflow">
          <h2>{t('ops.workflow.title')}</h2>
          <ol className="ops-workflow-steps">
            {workflowSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="muted ops-workflow-hint">{t('ops.workflow.hint')}</p>
          {crises.length > 0 && (
            <p>
              <Link to={`/ops/map?crisis_id=${selectedCrisisId}`} className="ops-dash-inline-link">
                {t('ops.workflow.goMap')}
              </Link>
            </p>
          )}
        </section>
      )}

      {activeTab === 'crises' && (
        <section className="ops-dash-section" id="crises">
          <h2>{t('ops.crises.title')}</h2>
          <p className="muted">{t('ops.crises.hint')}</p>

          <div className="ops-crisis-active-panel card">
            <h3>{t('ops.crises.activePanel')}</h3>
            {crises.length > 0 ? (
              <label className="ops-field">
                {t('ops.crises.select')}
                <select className="ops-input" value={selectedCrisisId} onChange={(e) => setSelectedCrisisId(e.target.value)}>
                  {crises.map((c) => (
                    <option key={c.id} value={c.id}>
                      {crisisName(c.name, c.slug)}
                      {isUnspecifiedCrisis(c) ? ` (${t('ops.crises.system')})` : ` (${c.archive_status})`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">
                {t('ops.crises.empty')}
                {isAdmin ? t('ops.crises.emptyAdmin') : t('ops.crises.emptyStaff')}
              </p>
            )}
            {selectedCrisis && isUnspecifiedCrisis(selectedCrisis) && (
              <p className="muted ops-crisis-system-note">{t('ops.crises.unspecifiedNote')}</p>
            )}
            {selectedCrisis && isManageableCrisis(selectedCrisis) && canEditSelectedCrisis && (
              <>
                <CrisisMetaFields
                  value={editCrisisMeta}
                  onChange={setEditCrisisMeta}
                  labels={crisisMetaLabels}
                  disabled={busy}
                />
                <button type="button" onClick={() => void saveSelectedCrisisMeta()} disabled={busy}>
                  {busy ? t('ops.crisis.saving') : t('ops.crisis.save')}
                </button>
                {crisisEditMsg && (
                  <p className={crisisEditMsg === t('ops.crisis.saved') ? 'ops-form-ok' : 'error'}>
                    {crisisEditMsg}
                  </p>
                )}
              </>
            )}
            {selectedCrisis && isManageableCrisis(selectedCrisis) && (
              <p>
                <Link to={`/ops/map?crisis_id=${selectedCrisisId}`} className="ops-dash-inline-link">
                  {t('ops.crises.toMap')}
                </Link>
              </p>
            )}
          </div>

          <div className="ops-crisis-list-panel">
            <h3>{t('ops.crises.listPanel')}</h3>
            <ul className="ops-crisis-list">
              {crises.map((c) => {
                const zoneCount = zones.filter((z) => z.crisis_id === c.id).length;
                const leads = opsUsers.flatMap((u) =>
                  (u.crisis_lead_assignments ?? [])
                    .filter((a) => a.crisis_id === c.id)
                    .map(() => u.email),
                );
                return (
                  <li key={c.id}>
                    <strong>{crisisName(c.name, c.slug)}</strong>
                    <span className="muted">
                      {' '}
                      · {c.slug}
                      {isUnspecifiedCrisis(c) ? ` · ${t('ops.crises.system')}` : ` · ${c.archive_status}`}
                      {!isUnspecifiedCrisis(c) && ` · ${t('ops.crises.zones', { count: zoneCount })}`}
                    </span>
                    {leads.length > 0 && (
                      <span className="muted"> · {t('ops.crises.lead', { names: leads.join('、') })}</span>
                    )}
                    {isManageableCrisis(c) && (
                      <Link to={`/ops/map?crisis_id=${c.id}`} className="ops-dash-inline-link">
                        {t('ops.crises.toMap')}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {activeTab === 'create-crisis' && isAdmin && (
        <section className="ops-dash-section">
          <h2>{t('ops.create.title')}</h2>
          <p className="muted">{t('ops.create.hint')}</p>
          <div className="ops-dash-form">
            <label className="ops-field">
              <span>{t('ops.create.slug')}</span>
              <input
                className="ops-input"
                placeholder="taipei-flood-2026"
                value={newCrisisSlug}
                onChange={(e) => setNewCrisisSlug(e.target.value)}
              />
            </label>
            <label className="ops-field">
              <span>{t('ops.create.name')}</span>
              <input
                className="ops-input"
                placeholder="2026 台北水患"
                value={newCrisisName}
                onChange={(e) => setNewCrisisName(e.target.value)}
              />
            </label>
            <p className="muted">{t('ops.create.statusHint')}</p>
            <CrisisMetaFields
              value={newCrisisMeta}
              onChange={setNewCrisisMeta}
              statusOptions={['draft', 'active']}
              labels={crisisMetaLabels}
              disabled={busy}
            />
            <button type="button" onClick={createCrisis} disabled={busy}>
              {busy ? t('ops.create.submitting') : t('ops.create.submit')}
            </button>
            {crisisFormMsg && (
              <p className={crisisFormMsg.startsWith('已建立') ? 'ops-form-ok' : 'error'}>{crisisFormMsg}</p>
            )}
          </div>
        </section>
      )}

      {activeTab === 'team' && (isAdmin || canAssignCoord) && (
        <section className="ops-dash-section" id="team">
          <h2>{t('ops.team.title')}</h2>
          {isAdmin && (
            <div className="ops-dash-form">
              <h3>新增營運人員</h3>
              <input
                className="ops-input"
                placeholder="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
              <input
                className="ops-input"
                type="password"
                placeholder="密碼（≥8）"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
              />
              <input
                className="ops-input"
                placeholder="顯示名稱（選填）"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
              />
              <label className="ops-field">
                {t('ops.team.roleLabel')}
                <select
                  className="ops-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as 'coordinator' | 'system_admin')}
                >
                  <option value="coordinator">{t('ops.team.roleCoordinator')}</option>
                  <option value="system_admin">{t('ops.team.roleSystemAdmin')}</option>
                </select>
              </label>
              <button type="button" onClick={createUser} disabled={busy}>
                {busy ? '建立中…' : '建立帳號'}
              </button>
              {userFormMsg && (
                <p className={userFormMsg.includes('@') ? 'ops-form-ok' : 'error'}>{userFormMsg}</p>
              )}
            </div>
          )}
          {isAdmin && (
            <div className="ops-dash-form">
              <h3>指派危機 Lead</h3>
              <p className="muted">可為任一危機指派 Lead，與上方「目前操作危機」無關。</p>
              <label className="ops-field">
                危機
                <select
                  className="ops-input"
                  value={assignLeadCrisisId}
                  onChange={(e) => setAssignLeadCrisisId(e.target.value)}
                >
                  <option value="">選擇危機</option>
                  {manageableCrises.map((c) => (
                    <option key={c.id} value={c.id}>
                      {crisisName(c.name, c.slug)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ops-field">
                營運人員
                <select className="ops-input" value={assignLeadUserId} onChange={(e) => setAssignLeadUserId(e.target.value)}>
                  <option value="">選擇營運人員</option>
                  {opsUsers.filter((u) => u.role !== 'system_admin').map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={assignCrisisLead} disabled={busy || !assignLeadCrisisId || !assignLeadUserId}>
                設為此危機 Lead
              </button>
              {leadFormMsg && (
                <p className={leadFormMsg.includes('請') ? 'error' : 'ops-form-ok'}>{leadFormMsg}</p>
              )}
            </div>
          )}
          {canAssignCoord && (
            <div className="ops-dash-form">
              <h3>指派分區 Coordinator</h3>
              <p className="muted">請先於營運地圖畫好分區，再指派人員。</p>
              {coordAssignableCrises.length > 0 && (
                <label className="ops-field">
                  {t('ops.crises.select')}
                  <select
                    className="ops-input"
                    value={coordCrisisId}
                    onChange={(e) => {
                      setAssignCoordCrisisId(e.target.value);
                      setAssignZoneId('');
                    }}
                  >
                    {coordAssignableCrises.map((c) => (
                      <option key={c.id} value={c.id}>
                        {crisisName(c.name, c.slug)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <select className="ops-input" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
                <option value="">選擇人員</option>
                {(isAdmin ? opsUsers.filter((u) => u.role !== 'system_admin') : assignableUsers).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
              <select className="ops-input" value={assignZoneId} onChange={(e) => setAssignZoneId(e.target.value)}>
                <option value="">選擇分區</option>
                {crisisZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={assignZoneToUser} disabled={busy || crisisZones.length === 0}>
                指派 Coordinator
              </button>
              {coordFormMsg && (
                <p className={coordFormMsg === t('ops.team.coordAssigned') ? 'ops-form-ok' : 'error'}>
                  {coordFormMsg}
                </p>
              )}
              {crisisZones.length === 0 && (
                <p className="muted">
                  {t('ops.team.noZones')}<Link to={`/ops/map?crisis_id=${coordCrisisId}`}>{t('ops.team.drawZonesLink')}</Link>
                </p>
              )}
            </div>
          )}
          {isAdmin && opsUsers.length > 0 && (
            <ul className="ops-users-list">
              {opsUsers.map((u) => (
                <li key={u.id}>
                  <strong>{u.email}</strong>
                  <span className="muted"> {roleLabel(u.role, t)}</span>
                  {u.crisis_lead_assignments?.length > 0 && (
                    <ul>
                      {u.crisis_lead_assignments.map((a) => (
                        <li key={`${u.id}-c-${a.crisis_id}`}>
                          危機 Lead — {a.crisis_slug ?? a.crisis_id.slice(0, 8)}
                          <button type="button" className="linkish" onClick={() => unassignCrisisLead(u.id, a.crisis_id)}>
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {u.zone_assignments.length > 0 && (
                    <ul>
                      {u.zone_assignments.map((a) => (
                        <li key={`${u.id}-${a.zone_id}`}>
                          {a.crisis_slug ?? t('ops.team.unknownCrisis')} — {a.zone_name ?? a.zone_id.slice(0, 8)} — coordinator
                          <button type="button" className="linkish" onClick={() => unassignZone(u.id, a.zone_id)}>
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="linkish"
                    disabled={busy}
                    onClick={() => {
                      setResetPwdUser(u);
                      setResetPwdValue('');
                      setUserFormMsg(null);
                    }}
                  >
                    {t('ops.team.resetPassword')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'audit' && isAdmin && (
        <section className="ops-dash-section">
          <h2>稽核紀錄</h2>
          <ul className="ops-audit-list">
            {audit.map((a) => (
              <li key={a.id}>
                <time>{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</time>
                <span>{a.action}</span>
                <span className="muted">{a.entity_type}</span>
              </li>
            ))}
          </ul>
          {audit.length === 0 && <p className="muted">尚無紀錄</p>}
        </section>
      )}
      {resetPwdUser && (
        <div
          className="ops-review-modal-backdrop"
          role="presentation"
          onClick={() => setResetPwdUser(null)}
        >
          <div
            className="ops-review-modal card ops-dash-form"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-reset-pwd-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ops-review-modal-header">
              <h2 id="ops-reset-pwd-title">{t('ops.team.resetPasswordTitle')}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setResetPwdUser(null)}
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </header>
            <p className="muted">{t('ops.team.resetPasswordHint', { email: resetPwdUser.email })}</p>
            <label className="ops-field">
              {t('ops.team.resetPasswordPlaceholder')}
              <input
                className="ops-input"
                type="password"
                autoComplete="new-password"
                value={resetPwdValue}
                onChange={(e) => setResetPwdValue(e.target.value)}
              />
            </label>
            <button type="button" disabled={busy || resetPwdValue.length < 8} onClick={() => void resetUserPassword()}>
              {busy ? t('ops.profile.passwordSaving') : t('ops.team.resetPasswordConfirm')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
