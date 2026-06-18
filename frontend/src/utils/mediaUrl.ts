import { apiUrl, resolveApiBase } from '../api';

function rewriteFilesPath(path: string): string | null {
  const idx = path.indexOf('/v1/files');
  if (idx < 0) return null;
  const suffix = path.slice(idx + '/v1/files'.length);
  const base = resolveApiBase('/v1/files');
  return `${base}/v1/files${suffix}`;
}

/** Resolve API media paths for use in img src (handles relative and misconfigured absolute URLs). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('blob:') || path.startsWith('data:')) return path;

  const rewritten = rewriteFilesPath(path);
  if (rewritten) return rewritten;

  if (path.startsWith('http')) {
    try {
      const host = new URL(path).hostname;
      if ((host === '127.0.0.1' || host === 'localhost') && path.includes('/v1/files')) {
        return rewriteFilesPath(path);
      }
    } catch {
      /* ignore */
    }
    return path;
  }

  return apiUrl(path);
}

export function normalizeThumbUrl<T extends { thumb_url?: string | null }>(item: T): T {
  const resolved = mediaUrl(item.thumb_url ?? null);
  if (resolved === item.thumb_url) return item;
  return { ...item, thumb_url: resolved };
}
