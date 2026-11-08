import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
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
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <LiveProvider>
            <Layout>
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
                  <Route path="*" element={<p className="text-sm text-ink-3">Página no encontrada.</p>} />
                </Routes>
              </Suspense>
            </Layout>
          </LiveProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
