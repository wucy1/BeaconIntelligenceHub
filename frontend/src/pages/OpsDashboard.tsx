import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

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
  clearOpsSession,
  getOpsUser,
  opsCanAssignCoordinator,
  opsCanManageUsers,
  opsIsCrisisLead,
  opsIsSystemAdmin,
} from '../ops/opsAuth';

function crisisLabel(c: OpsCrisis): string {
  return c.name['zh-Hant'] ?? c.name.zh ?? c.name.en ?? c.slug;
}

function roleLabel(role: string): string {
  if (role === 'system_admin') return '系統管理員';
  return '營運人員';
}

export function OpsDashboard() {
  const user = getOpsUser();
  const isAdmin = opsIsSystemAdmin(user);

  const [crises, setCrises] = useState<OpsCrisis[]>([]);
  const [zones, setZones] = useState<OpsZone[]>([]);
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
  const [assignUserId, setAssignUserId] = useState('');
  const [assignZoneId, setAssignZoneId] = useState('');

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedCrisis = crises.find((c) => c.id === selectedCrisisId) ?? null;
  const crisisZones = zones.filter((z) => z.crisis_id === selectedCrisisId);
  const canAssignCoord = selectedCrisisId ? opsCanAssignCoordinator(user, selectedCrisisId) : false;
  const isLeadForSelected = selectedCrisisId ? opsIsCrisisLead(user, selectedCrisisId) : false;

  const loadCrises = useCallback(() => {
    opsGet<{ items: OpsCrisis[] }>('/v1/ops/crises')
      .then((d) => {
        setCrises(d.items);
        if (!selectedCrisisId && d.items.length > 0) setSelectedCrisisId(d.items[0].id);
      })
      .catch(() => setCrises([]));
  }, [selectedCrisisId]);

  const loadZones = useCallback(() => {
    opsGet<{ items: OpsZone[] }>('/v1/ops/zones')
      .then((d) => setZones(d.items))
      .catch(() => setZones([]));
  }, []);

  const loadUsers = useCallback(() => {
    if (!opsCanManageUsers(user)) return;
    opsGet<{ items: OpsUserRecord[] }>('/v1/ops/users')
      .then((d) => setOpsUsers(d.items))
      .catch(() => setOpsUsers([]));
  }, [user]);

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

  useEffect(() => {
    loadCrises();
    loadZones();
    loadUsers();
    loadAudit();
  }, [loadCrises, loadZones, loadUsers, loadAudit]);

  useEffect(() => {
    loadAssignableUsers();
  }, [loadAssignableUsers, selectedCrisisId]);

  if (!user) return <Navigate to="/ops/login" replace />;

  const logout = () => {
    clearOpsSession();
    window.location.href = '/ops/login';
  };

  const createCrisis = async () => {
    if (!newCrisisSlug.trim() || !newCrisisName.trim()) {
      setErr('請填寫 slug 與名稱');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await opsPost<OpsCrisis>('/v1/ops/crises', {
        slug: newCrisisSlug.trim(),
        name: { 'zh-Hant': newCrisisName.trim() },
        archive_status: 'draft',
      });
      setNewCrisisSlug('');
      setNewCrisisName('');
      setSelectedCrisisId(c.id);
      loadCrises();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createUser = async () => {
    if (!newUserEmail.trim() || newUserPassword.length < 8) {
      setErr('請填 email 與至少 8 字元密碼');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await opsPost('/v1/ops/users', {
        email: newUserEmail.trim(),
        password: newUserPassword,
        display_name: newUserName.trim() || null,
        role: 'coordinator',
      });
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignCrisisLead = async () => {
    if (!assignLeadUserId || !selectedCrisisId) {
      setErr('請選擇人員與危機');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await opsPost(`/v1/ops/users/${assignLeadUserId}/crises/${selectedCrisisId}`, {});
      setAssignLeadUserId('');
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assignZoneToUser = async () => {
    if (!assignUserId || !assignZoneId) {
      setErr('請選擇人員與分區');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await opsPost(`/v1/ops/users/${assignUserId}/zones/${assignZoneId}`, {
        assignment_role: 'coordinator',
      });
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unassignCrisisLead = async (userId: string, crisisId: string) => {
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/users/${userId}/crises/${crisisId}`);
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unassignZone = async (userId: string, zoneId: string) => {
    setBusy(true);
    try {
      await opsDelete(`/v1/ops/users/${userId}/zones/${zoneId}`);
      loadUsers();
      loadAudit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const workflowSteps = isAdmin
    ? [
        '建立危機（下方「危機管理」）',
        '新增營運人員帳號',
        '指派危機 Lead（負責該危機的分區與團隊）',
        'Lead 至營運地圖畫分區',
        'Lead 指派 Coordinator 到各分區',
        '於營運地圖或儀表板審核回報；必要時執行歸檔',
      ]
    : isLeadForSelected
      ? [
          '至營運地圖為目前危機畫分區',
          '指派 Coordinator 到各分區',
          '於營運地圖或儀表板審核回報',
          '於營運地圖執行危機歸檔（設定時間窗後預覽／執行）',
        ]
      : [
          '至營運地圖或回報儀表板查看指派分區內的回報',
          '點選回報標記審核或加旗標',
        ];

  return (
    <section className="card ops-dashboard">
      <header className="ops-dash-header">
        <div>
          <h1>營運控制台</h1>
          <p className="muted">
            {user.email} · {roleLabel(user.role)}
            {user.crisis_lead_assignments && user.crisis_lead_assignments.length > 0 && (
              <> · 危機 Lead ×{user.crisis_lead_assignments.length}</>
            )}
          </p>
        </div>
        <nav className="ops-dash-nav">
          <Link to="/ops/map">營運地圖</Link>
          <Link to="/dashboard">回報儀表板</Link>
          <Link to="/">回報地圖</Link>
          <button type="button" className="secondary" onClick={logout}>
            登出
          </button>
        </nav>
      </header>

      {err && <p className="error">{err}</p>}

      <section className="ops-dash-section ops-dash-workflow">
        <h2>營運流程</h2>
        <ol className="ops-workflow-steps">
          {workflowSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="muted ops-workflow-hint">
          危機 → 指派 Lead → Lead 畫分區 → 指派 Coordinator → 審核回報／歸檔
        </p>
      </section>

      <section className="ops-dash-section" id="crises">
        <h2>危機管理</h2>
        {crises.length > 0 && (
          <label className="ops-field">
            目前操作危機
            <select value={selectedCrisisId} onChange={(e) => setSelectedCrisisId(e.target.value)}>
              {crises.map((c) => (
                <option key={c.id} value={c.id}>
                  {crisisLabel(c)} ({c.archive_status})
                </option>
              ))}
            </select>
          </label>
        )}
        {isAdmin && (
          <div className="ops-dash-form">
            <h3>新增危機</h3>
            <p className="muted">僅系統管理員可建立。建立後請指派危機 Lead，再由 Lead 至營運地圖畫分區。</p>
            <input
              className="ops-input"
              placeholder="slug（英文，如 taipei-flood-2026）"
              value={newCrisisSlug}
              onChange={(e) => setNewCrisisSlug(e.target.value)}
            />
            <input
              className="ops-input"
              placeholder="顯示名稱（繁中）"
              value={newCrisisName}
              onChange={(e) => setNewCrisisName(e.target.value)}
            />
            <button type="button" onClick={createCrisis} disabled={busy}>
              建立危機
            </button>
          </div>
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
                <strong>{crisisLabel(c)}</strong>
                <span className="muted"> · {c.slug} · {zoneCount} 個分區</span>
                {leads.length > 0 && <span className="muted"> · Lead：{leads.join('、')}</span>}
                {selectedCrisisId === c.id && (
                  <Link to={`/ops/map`} className="ops-dash-inline-link">
                    至地圖畫分區 →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {crises.length === 0 && <p className="muted">尚無危機。{isAdmin ? '請使用上方表單建立。' : '請聯絡系統管理員。'}</p>}
      </section>

      {(isAdmin || canAssignCoord) && (
        <section className="ops-dash-section" id="team">
          <h2>團隊管理</h2>
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
                建立帳號
              </button>
            </div>
          )}
          {isAdmin && (
            <div className="ops-dash-form">
              <h3>指派危機 Lead</h3>
              <p className="muted">危機：{selectedCrisis ? crisisLabel(selectedCrisis) : '—'}</p>
              <select className="ops-input" value={assignLeadUserId} onChange={(e) => setAssignLeadUserId(e.target.value)}>
                <option value="">選擇營運人員</option>
                {opsUsers.filter((u) => u.role !== 'system_admin').map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
              <button type="button" onClick={assignCrisisLead} disabled={busy || !selectedCrisisId}>
                設為此危機 Lead
              </button>
            </div>
          )}
          {canAssignCoord && (
            <div className="ops-dash-form">
              <h3>指派分區 Coordinator</h3>
              <p className="muted">請先於營運地圖畫好分區，再指派人員。</p>
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
                  此危機尚無分區。<Link to="/ops/map">至營運地圖畫分區</Link>
                </p>
              )}
            </div>
          )}
          {isAdmin && opsUsers.length > 0 && (
            <ul className="ops-users-list">
              {opsUsers.map((u) => (
                <li key={u.id}>
                  <strong>{u.email}</strong>
                  <span className="muted"> {roleLabel(u.role)}</span>
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

      {isAdmin && (
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
