import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from './components/LanguageSwitcher';
import { OfflineBanner } from './components/OfflineBanner';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { Admin } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { Home } from './pages/Home';
import { MapPage } from './pages/MapPage';
import { OpsDashboard } from './pages/OpsDashboard';
import { OpsLogin } from './pages/OpsLogin';
import { OpsMapPage } from './pages/OpsMapPage';
import { ReportNew } from './pages/ReportNew';

import './App.css';

function DevLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="layout">
      <header className="header">
        <strong>{t('app.title')}</strong>
        <nav>
          <a href="/">{t('map.mode.all')}</a>
          <a href="/dev">{t('nav.home')}</a>
          <a href="/dashboard">{t('nav.dashboard')}</a>
          <a href="/admin">{t('nav.admin')}</a>
          <a href="/ops">營運控制台</a>
          <LanguageSwitcher />
        </nav>
      </header>
      <OfflineBanner />
      <main className="main">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route
            path="/dev"
            element={
              <DevLayout>
                <Home />
              </DevLayout>
            }
          />
          <Route
            path="/r/:crisisId/new"
            element={
              <DevLayout>
                <ReportNew />
              </DevLayout>
            }
          />
          <Route
            path="/dashboard"
            element={
              <DevLayout>
                <Dashboard />
              </DevLayout>
            }
          />
          <Route
            path="/admin"
            element={
              <DevLayout>
                <Admin />
              </DevLayout>
            }
          />
          <Route
            path="/ops/login"
            element={
              <DevLayout>
                <OpsLogin />
              </DevLayout>
            }
          />
          <Route
            path="/ops"
            element={
              <DevLayout>
                <OpsDashboard />
              </DevLayout>
            }
          />
          <Route path="/ops/map" element={<OpsMapPage />} />
          <Route path="/ops/zones" element={<Navigate to="/ops/map" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
