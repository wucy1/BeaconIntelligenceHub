import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 上線初期先不註冊 SW，避免快取舊版 index/JS（離線 PWA 階段再啟用）。
// if ('serviceWorker' in navigator && import.meta.env.PROD) {
//   void navigator.serviceWorker.register('/sw.js')
// }
