const TOKEN_KEY = 'bih-ops-token';
const USER_KEY = 'bih-ops-user';

export type ZoneAssignment = {
  zone_id: string;
  zone_name?: string;
  assignment_role: 'lead' | 'coordinator';
};

export type OpsUserSession = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'coordinator' | 'crisis_lead' | 'system_admin';
  zone_ids: string[];
  zone_assignments?: ZoneAssignment[];
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

export function opsIsSystemAdmin(user: OpsUserSession | null): boolean {
  return user?.role === 'system_admin';
}

export function opsCanCreateZones(user: OpsUserSession | null): boolean {
  return opsIsSystemAdmin(user);
}

export function opsCanEditZone(user: OpsUserSession | null, zoneId: string): boolean {
  if (!user) return false;
  if (opsIsSystemAdmin(user)) return true;
  return (user.zone_assignments ?? []).some(
    (a) => a.zone_id === zoneId && a.assignment_role === 'lead',
  );
}

export function opsCanRunArchive(user: OpsUserSession | null): boolean {
  if (!user) return false;
  if (opsIsSystemAdmin(user)) return true;
  return (user.zone_assignments ?? []).some((a) => a.assignment_role === 'lead');
}

export function opsCanManageUsers(user: OpsUserSession | null): boolean {
  return opsIsSystemAdmin(user);
}
