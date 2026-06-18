import { useEffect, useState } from 'react';

import { apiFetch } from '../api';
import { apiImagePath, mediaUrl } from '../utils/mediaUrl';

type Props = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  loading?: 'eager' | 'lazy';
};

/** Load API-hosted images via authenticated fetch (works in cross-origin PWA). */
export function ApiImage({ src, alt = '', className, loading = 'lazy' }: Props) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      return;
    }
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setResolved(src);
      return () => undefined;
    }

    const path = apiImagePath(src);
    if (!path.startsWith('/v1/files')) {
      setResolved(mediaUrl(src));
      return () => undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    void apiFetch(path)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setResolved(mediaUrl(src));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} className={className} loading={loading} />;
}
