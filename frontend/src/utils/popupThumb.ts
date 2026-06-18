import { apiFetch } from '../api';
import { apiImagePath, mediaUrl } from './mediaUrl';

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}

/** HTML for a map popup thumbnail (hydrate with hydratePopupThumbs after open). */
export function popupThumbHtml(thumbUrl: string | null | undefined): string {
  const src = mediaUrl(thumbUrl);
  if (!src) return '';
  const escaped = escapeAttr(src);
  return `<img alt="" class="marker-popup-thumb" data-api-thumb="${escaped}" style="max-width:120px;border-radius:6px;display:block" />`;
}

/** Load API-hosted thumbs via fetch (same approach as ApiImage). */
export function hydratePopupThumbs(root: ParentNode): void {
  root.querySelectorAll('img[data-api-thumb]').forEach((el) => {
    const img = el as HTMLImageElement;
    const raw = img.dataset.apiThumb;
    if (!raw || img.dataset.apiThumbLoaded === '1') return;

    const path = apiImagePath(raw);
    if (!path.startsWith('/v1/files')) {
      img.src = mediaUrl(raw) ?? raw;
      img.dataset.apiThumbLoaded = '1';
      return;
    }

    void apiFetch(path)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        img.src = URL.createObjectURL(blob);
        img.dataset.apiThumbLoaded = '1';
      })
      .catch(() => {
        img.src = mediaUrl(raw) ?? raw;
        img.dataset.apiThumbLoaded = '1';
      });
  });
}
