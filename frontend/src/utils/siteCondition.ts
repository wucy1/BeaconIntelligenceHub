import type { DamageLevel } from '../config/questionnaire';

/** Single UI choice → API damage_level + appendix site_status */
export type SiteCondition = DamageLevel | 'repaired' | 'demolished';

export const SITE_CONDITIONS: SiteCondition[] = [
  'minimal',
  'partial',
  'complete',
  'repaired',
  'demolished',
];

export function fieldsFromSiteCondition(condition: SiteCondition): {
  damage_level: DamageLevel;
  site_status: 'affected' | 'repaired' | 'demolished';
} {
  if (condition === 'repaired') {
    return { damage_level: 'minimal', site_status: 'repaired' };
  }
  if (condition === 'demolished') {
    return { damage_level: 'complete', site_status: 'demolished' };
  }
  return { damage_level: condition, site_status: 'affected' };
}

export function siteConditionFromFields(
  damageLevel: string,
  appendix?: Record<string, string | string[]>,
): SiteCondition {
  const site = (appendix?.site_status as string) ?? 'affected';
  if (site === 'repaired') return 'repaired';
  if (site === 'demolished') return 'demolished';
  if (damageLevel === 'minimal' || damageLevel === 'partial' || damageLevel === 'complete') {
    return damageLevel;
  }
  return 'partial';
}

/** i18n key for unified site condition label */
export function siteConditionLabelKey(condition: SiteCondition): string {
  if (condition === 'repaired' || condition === 'demolished') {
    return `report.siteStatus.${condition}`;
  }
  return `report.damage.${condition}`;
}

export function chipClassForCondition(condition: SiteCondition): string {
  if (condition === 'repaired') return 'chip-repaired';
  if (condition === 'demolished') return 'chip-demolished';
  return `chip-${condition}`;
}
