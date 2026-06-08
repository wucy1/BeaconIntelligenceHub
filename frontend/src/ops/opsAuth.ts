const TOKEN_KEY = 'bih-ops-token';
const USER_KEY = 'bih-ops-user';

export type OpsUserSession = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'coordinator' | 'crisis_lead' | 'system_admin';
  zone_ids: string[];
};

export function getOpsToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getOpsUser(): OpsUserSession | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpsUserSession;
  } catch {
    return null;
  }
}

export function setOpsSession(token: string, user: OpsUserSession): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearOpsSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function opsCanManageZones(role: OpsUserSession['role']): boolean {
  return role === 'crisis_lead' || role === 'system_admin';
}
