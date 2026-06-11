export function isUnspecifiedCrisis(c: { slug: string } | null | undefined): boolean {
  return c?.slug === 'unspecified';
}

/** 可設定狀態、畫分區、歸檔的正式危機（排除系統 unspecified） */
export function isManageableCrisis(c: { slug: string } | null | undefined): boolean {
  return Boolean(c && !isUnspecifiedCrisis(c));
}
