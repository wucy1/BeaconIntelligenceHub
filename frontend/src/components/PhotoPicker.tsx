import { useRef, type ChangeEvent } from 'react';

import { useI18n } from '../i18n/I18nContext';

type Props = {
  onSelect: (file: File | null) => void;
};

export function PhotoPicker({ onSelect }: Props) {
  const { t } = useI18n();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onSelect(e.target.files?.[0] ?? null);
    e.target.value = '';
  };

  return (
    <div className="photo-picker">
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="photo-picker-input"
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="photo-picker-input"
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden
      />
      <div className="photo-picker-actions">
        <button type="button" className="secondary" onClick={() => galleryRef.current?.click()}>
          {t('report.photoGallery')}
        </button>
        <button type="button" onClick={() => cameraRef.current?.click()}>
          {t('report.photoCamera')}
        </button>
      </div>
      <p className="field-hint muted">{t('report.photoHint')}</p>
    </div>
  );
}
