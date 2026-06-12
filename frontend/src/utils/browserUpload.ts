const PREFER_API_UPLOAD_KEY = 'bih-prefer-api-upload';

/** 曾經 R2 直傳失敗後記住，下次優先走 API 代理（不限瀏覽器） */
export function rememberApiUploadPreferred(): void {
  try {
    localStorage.setItem(PREFER_API_UPLOAD_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearApiUploadPreference(): void {
  try {
    localStorage.removeItem(PREFER_API_UPLOAD_KEY);
  } catch {
    /* ignore */
  }
}

function hasStoredApiUploadPreference(): boolean {
  try {
    return localStorage.getItem(PREFER_API_UPLOAD_KEY) === '1';
  } catch {
    return false;
  }
}

/** 啟發式：Safari / iOS WebView / Brave 較常擋跨域 R2 PUT */
function isLikelyStrictUploadBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPR|Brave/i.test(ua);
  const isBraveUa = /\bbrave\b/i.test(ua);
  return isIos || isSafari || isBraveUa;
}

/** 是否應先嘗試 API 代理上傳（記憶優先，其次瀏覽器啟發式） */
export async function shouldTryApiUploadFirst(): Promise<boolean> {
  if (hasStoredApiUploadPreference()) return true;
  if (isLikelyStrictUploadBrowser()) {
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    if (nav.brave?.isBrave) {
      try {
        if (await nav.brave.isBrave()) return true;
      } catch {
        return true;
      }
    }
    return true;
  }
  return false;
}

/** 所有瀏覽器：喚醒逾時後仍嘗試提交，由 apiFetch 重試 */
export function shouldSoftWakeApi(): boolean {
  return true;
}
