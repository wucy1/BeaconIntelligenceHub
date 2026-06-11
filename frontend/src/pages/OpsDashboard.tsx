import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { wakeApiBackend } from '../api';
import { useI18n } from '../i18n/I18nContext';
import {
  opsDelete,
  opsGet,
  opsPost,
  type AuditEntry,
  type OpsCrisis,
  type OpsUserRecord,
  type OpsZone,
} from '../ops/opsApi';
import {
  getOpsUser,
  opsCanAssignCoordinator,
  opsIsCrisisLead,
  opsIsSystemAdmin,
} from '../ops/opsAuth';
import { readOpsCrisesCache, readOpsZonesCache, writeOpsCrisesCache, writeOpsZonesCache } from '../ops/opsCache';
import { isOpsDemoHosting } from '../ops/opsHosting';
import { OpsTabs } from '../components/ops/OpsTabs';
import { OPS_LABELS } from '../ops/opsLabels';

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
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [assignLeadUserId, setAssignLeadUserId] = useState('');
  const [assignLeadCrisisId, setAssignLeadCrisisId] = useState('');
  const [assignCoordCrisisId, setAssignCoordCrisisId] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignZoneId, setAssignZoneId] = useState('');

  const [apiBanner, setApiBanner] = useState<string | null>(null);
  const [apiWaking, setApiWaking] = useState(false);
  const [crisisFormMsg, setCrisisFormMsg] = useState<string | null>(null);
  const [teamFormMsg, setTeamFormMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<OpsTabId>('overview');

  const selectedCrisis = crises.find((c) => c.id === selectedCrisisId) ?? null;
  const assignLeadCrisis = crises.find((c) => c.id === assignLeadCrisisId) ?? null;
  const coordCrisisId = isAdmin ? assignCoordCrisisId : selectedCrisisId;
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
    loadAssignableUsers();
  }, [loadAssignableUsers, selectedCrisisId]);

  if (!user) return <Navigate to="/ops/login" replace />;

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
        archive_status: 'draft',
      });
      setCrises((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
      setSelectedCrisisId(c.id);
      setNewCrisisSlug('');
      setNewCrisisName('');
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

  const createUser = async () => {
    if (!newUserEmail.trim() || newUserPassword.length < 8) {
      setTeamFormMsg('請填 email 與至少 8 字元密碼');
      return;
    }
    setBusy(true);
    setTeamFormMsg(null);
    try {
      const created = await opsPost<OpsUserRecord>('/v1/ops/users', {
        email: newUserEmail.trim().toLowerCase(),
        password: newUserPassword,
        display_name: newUserName.trim() || null,
        role: 'coordinator',
      });
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      setOpsUsers((prev) => (prev.some((u) => u.id === created.id) ? prev : [...prev, created]));
      setTeamFormMsg(`已建立帳號 ${created.email}`);
      await loadUsers();
      loadAudit();
    } catch (e) {
      setTeamFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignCrisisLead = async () => {
    if (!assignLeadUserId || !assignLeadCrisisId) {
      setTeamFormMsg('請選擇危機與營運人員');
      return;
    }
    setBusy(true);
    setTeamFormMsg(null);
    const leadEmail = opsUsers.find((u) => u.id === assignLeadUserId)?.email;
    const crisisTitle = assignLeadCrisis ? crisisName(assignLeadCrisis.name, assignLeadCrisis.slug) : '';
    try {
      await opsPost(`/v1/ops/users/${assignLeadUserId}/crises/${assignLeadCrisisId}`, {});
      setAssignLeadUserId('');
      setTeamFormMsg(`已指派 ${leadEmail ?? '人員'} 為「${crisisTitle}」Lead`);
      await loadUsers();
      loadAudit();
    } catch (e) {
      setTeamFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignZoneToUser = async () => {
    if (!assignUserId || !assignZoneId) {
      setTeamFormMsg('請選擇人員與分區');
      return;
    }
    setBusy(true);
    setTeamFormMsg(null);
    try {
      await opsPost(`/v1/ops/users/${assignUserId}/zones/${assignZoneId}`, {
        assignment_role: 'coordinator',
      });
      setTeamFormMsg('已指派 Coordinator');
      await loadUsers();
      loadAudit();
    } catch (e) {
      setTeamFormMsg(e instanceof Error ? e.message : String(e));
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
      setTeamFormMsg(e instanceof Error ? e.message : String(e));
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
      setTeamFormMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const workflowSteps = isAdmin
    ? [
        '「新增危機」分頁建立危機',
        '「人員管理」新增帳號並指派 Lead',
        'Lead 至營運地圖畫分區',
        'Lead 指派 Coordinator 到各分區',
        '於營運地圖或儀表板審核回報；必要時執行歸檔',
      ]
    : isLeadForSelected
      ? [
          '至營運地圖為目前危機畫分區',
          '「人員管理」指派 Coordinator 到各分區',
          '於營運地圖或儀表板審核回報',
          '於營運地圖執行危機歸檔（設定時間窗後預覽／執行）',
        ]
      : [
          `至${OPS_LABELS.map}或${OPS_LABELS.dashboard}查看指派分區內的回報`,
          '點選回報標記審核或加旗標',
        ];

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
          {crises.length > 0 && (
            <label className="ops-field">
              {t('ops.crises.select')}
              <select className="ops-input" value={selectedCrisisId} onChange={(e) => setSelectedCrisisId(e.target.value)}>
                {crises.map((c) => (
                  <option key={c.id} value={c.id}>
                    {crisisName(c.name, c.slug)} ({c.archive_status})
                  </option>
                ))}
              </select>
            </label>
          )}
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
                    · {c.slug} · {t('ops.crises.zones', { count: zoneCount })}
                  </span>
                  {leads.length > 0 && (
                    <span className="muted"> · {t('ops.crises.lead', { names: leads.join('、') })}</span>
                  )}
                  <Link to={`/ops/map?crisis_id=${c.id}`} className="ops-dash-inline-link">
                    {t('ops.crises.toMap')}
                  </Link>
                </li>
              );
            })}
          </ul>
          {crises.length === 0 && (
            <p className="muted">
              {t('ops.crises.empty')}
              {isAdmin ? t('ops.crises.emptyAdmin') : t('ops.crises.emptyStaff')}
            </p>
          )}
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
              <button type="button" onClick={createUser} disabled={busy}>
                {busy ? '建立中…' : '建立帳號'}
              </button>
              {teamFormMsg && (
                <p className={teamFormMsg.startsWith('已建立') ? 'ops-form-ok' : 'error'}>{teamFormMsg}</p>
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
                  {crises.map((c) => (
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
            </div>
          )}
          {canAssignCoord && (
            <div className="ops-dash-form">
              <h3>指派分區 Coordinator</h3>
              <p className="muted">請先於營運地圖畫好分區，再指派人員。</p>
              {isAdmin && crises.length > 0 && (
                <label className="ops-field">
                  危機
                  <select
                    className="ops-input"
                    value={assignCoordCrisisId}
                    onChange={(e) => {
                      setAssignCoordCrisisId(e.target.value);
                      setAssignZoneId('');
                    }}
                  >
                    {crises.map((c) => (
                      <option key={c.id} value={c.id}>
                        {crisisName(c.name, c.slug)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!isAdmin && selectedCrisis && (
                <p className="muted">危機：{crisisName(selectedCrisis.name, selectedCrisis.slug)}</p>
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
              {crisisZones.length === 0 && (
                <p className="muted">
                  此危機尚無分區。<Link to={`/ops/map?crisis_id=${coordCrisisId}`}>至{OPS_LABELS.map}畫分區</Link>
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
                          {a.zone_name ?? a.zone_id.slice(0, 8)} — coordinator
                          <button type="button" className="linkish" onClick={() => unassignZone(u.id, a.zone_id)}>
                            移除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
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
    </section>
  );
}
