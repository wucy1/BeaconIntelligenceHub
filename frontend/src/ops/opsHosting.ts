import { apiBase } from '../api';

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/** Demo 託管（Render 免費方案）才顯示冷啟動說明；正式上線可設 VITE_OPS_DEMO_HOSTING=0 */
export function isOpsDemoHosting(): boolean {
  const flag = import.meta.env.VITE_OPS_DEMO_HOSTING;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  if (isLocalDevHost()) return false;
  const fallback = import.meta.env.VITE_API_FALLBACK ?? '';
  if (fallback.includes('onrender.com')) return true;
  return !apiBase();
}
