const TOKEN_KEY = 'bih-ops-token';
const USER_KEY = 'bih-ops-user';

export type ZoneAssignment = {
  zone_id: string;
  zone_name?: string;
  assignment_role: 'lead' | 'coordinator';
};

export type CrisisLeadAssignment = {
  crisis_id: string;
  crisis_slug?: string;
  crisis_name?: Record<string, string> | string;
};

export type OpsUserSession = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'coordinator' | 'crisis_lead' | 'system_admin';
  zone_ids: string[];
  zone_assignments?: ZoneAssignment[];
  crisis_lead_assignments?: CrisisLeadAssignment[];
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

export function opsIsCrisisLead(user: OpsUserSession | null, crisisId: string): boolean {
  if (!user) return false;
  if (opsIsSystemAdmin(user)) return true;
  return (user.crisis_lead_assignments ?? []).some((a) => a.crisis_id === crisisId);
}

export function opsCanCreateZones(user: OpsUserSession | null, crisisId: string): boolean {
  return opsIsCrisisLead(user, crisisId);
}

export function opsCanEditZone(
  user: OpsUserSession | null,
  crisisId: string | null | undefined,
): boolean {
  if (!crisisId) return opsIsSystemAdmin(user);
  return opsIsCrisisLead(user, crisisId);
}

export function opsCanRunArchive(user: OpsUserSession | null, crisisId: string): boolean {
  return opsIsCrisisLead(user, crisisId);
}

export function opsCanManageUsers(user: OpsUserSession | null): boolean {
  return opsIsSystemAdmin(user);
}

export function opsCanAssignCoordinator(
  user: OpsUserSession | null,
  crisisId: string | null | undefined,
): boolean {
  if (!crisisId) return false;
  return opsIsCrisisLead(user, crisisId);
}

export function opsCanOpenStaffPanel(user: OpsUserSession | null): boolean {
  if (!user) return false;
  if (opsIsSystemAdmin(user)) return true;
  return (user.crisis_lead_assignments?.length ?? 0) > 0;
}
