import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, RouteErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Nodo } from './components/Nodo';
import './index.css';
import { AssistantProvider } from './lib/assistant';
import { AuthProvider } from './lib/auth';
import { LiveProvider } from './lib/live';
import { ToastProvider } from './lib/toast';
import { AlertsPage } from './pages/AlertsPage';
import { Dashboard } from './pages/Dashboard';
import { DeviceDetail, DevicesPage } from './pages/DevicesPage';
import { SettingsPage } from './pages/SettingsPage';

// Las vistas con librerías pesadas (mapa, gráficos) se cargan bajo demanda.
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })));

// Tema inicial antes del primer render (evita parpadeo). Oscuro por defecto: es una sala de control.
let initialTheme = 'dark';
try {
  if (localStorage.getItem('scbga.theme') === 'light') initialTheme = 'light';
} catch {
  /* sin almacenamiento */
}
document.documentElement.dataset.theme = initialTheme;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <LiveProvider>
            <AssistantProvider>
            <Layout>
              <RouteErrorBoundary>
              <Suspense fallback={<p className="label py-10">Cargando módulo…</p>}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/mapa" element={<MapPage />} />
                  <Route path="/dispositivos" element={<DevicesPage />} />
                  <Route path="/dispositivos/:id" element={<DeviceDetail />} />
                  <Route path="/historico" element={<HistoryPage />} />
                  <Route path="/alertas" element={<AlertsPage />} />
                  <Route path="/asistente" element={<AssistantPage />} />
                  <Route path="/configuracion" element={<SettingsPage />} />
                  <Route path="*" element={<div className="flex items-center gap-4"><Nodo mood="thinking" size={72} /><p className="text-sm text-ink-3">Esa calle no está en el mapa. <Link to="/" className="font-semibold text-accent underline">Volver al panel</Link></p></div>} />
                </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </Layout>
            </AssistantProvider>
          </LiveProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
