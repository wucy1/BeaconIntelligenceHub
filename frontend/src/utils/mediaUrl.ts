import { apiUrl } from '../api';

/** Resolve API-relative media paths (e.g. /v1/files?key=…) for use in img src. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }
  return apiUrl(path);
}

export function normalizeThumbUrl<T extends { thumb_url?: string | null }>(item: T): T {
  const resolved = mediaUrl(item.thumb_url ?? null);
  if (resolved === item.thumb_url) return item;
  return { ...item, thumb_url: resolved };
}
