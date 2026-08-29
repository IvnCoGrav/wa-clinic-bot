import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Layout } from './components/common/Layout';
import { UiFeedbackProvider } from './components/common/UiFeedback';
import { StaffAuthProvider } from './contexts/StaffAuthContext';
import { StaffProtectedRoute } from './components/staff/StaffProtectedRoute';
import { Login } from './pages/auth/Login';
import { BootProgress } from './components/common/BootProgress';
import { emitBootPhase } from './lib/bootProgress';
import { getDefaultRedirect } from './config/rolePermissions';

// Lazy load pages for fast initial bundle sizes (code-splitting rationale)
const Overview = lazy(() => import('./pages/tenant/Overview').then(m => ({ default: m.Overview })));
const Reservations = lazy(() => import('./pages/tenant/Reservations').then(m => ({ default: m.Reservations })));
const TodayTreatments = lazy(() => import('./pages/tenant/TodayTreatments').then(m => ({ default: m.TodayTreatments })));
const KnowledgeBase = lazy(() => import('./pages/tenant/KnowledgeBase').then(m => ({ default: m.KnowledgeBase })));
const AiSandbox = lazy(() => import('./pages/tenant/AiSandbox').then(m => ({ default: m.AiSandbox })));
const LiveChatMonitor = lazy(() => import('./pages/tenant/LiveChatMonitor').then(m => ({ default: m.LiveChatMonitor })));
const Settings = lazy(() => import('./pages/tenant/Settings').then(m => ({ default: m.Settings })));
const ClinicServices = lazy(() => import('./pages/tenant/ClinicServices').then(m => ({ default: m.ClinicServices })));
const AiPersona = lazy(() => import('./pages/tenant/AiPersona').then(m => ({ default: m.AiPersona })));
const DeliveryTiers = lazy(() => import('./pages/tenant/DeliveryTiers').then(m => ({ default: m.DeliveryTiers })));
const FollowUpQueue = lazy(() => import('./pages/tenant/FollowUpQueue').then(m => ({ default: m.FollowUpQueue })));
const FollowUpTemplates = lazy(() => import('./pages/tenant/FollowUpTemplates').then(m => ({ default: m.FollowUpTemplates })));
const Debug = lazy(() => import('./pages/tenant/Debug').then(m => ({ default: m.Debug })));
const LandingPage = lazy(() => import('./pages/tenant/LandingPage').then(m => ({ default: m.LandingPage })));
const CustomerDatabase = lazy(() => import('./pages/tenant/CustomerDatabase').then(m => ({ default: m.CustomerDatabase })));
const CustomerLabels = lazy(() => import('./pages/tenant/CustomerLabels').then(m => ({ default: m.CustomerLabels })));
const CustomerService = lazy(() => import('./pages/tenant/CustomerService').then(m => ({ default: m.CustomerService })));
const AiEvaluations = lazy(() => import('./pages/tenant/AiEvaluations').then(m => ({ default: m.AiEvaluations })));
const MetaClickCatcher = lazy(() => import('./pages/tenant/MetaClickCatcher').then(m => ({ default: m.MetaClickCatcher })));
const MetaCapiQueue = lazy(() => import('./pages/tenant/MetaCapiQueue').then(m => ({ default: m.MetaCapiQueue })));
const ChatExport = lazy(() => import('./pages/tenant/ChatExport').then(m => ({ default: m.ChatExport })));
const ChatMigration = lazy(() => import('./pages/tenant/ChatMigration').then(m => ({ default: m.ChatMigration })));
const StaffLogin = lazy(() => import('./pages/staff/StaffLogin').then(m => ({ default: m.StaffLogin })));
const StaffToday = lazy(() => import('./pages/staff/StaffToday').then(m => ({ default: m.StaffToday })));
const StaffSchedule = lazy(() => import('./pages/staff/StaffSchedule').then(m => ({ default: m.StaffSchedule })));
const StaffManagement = lazy(() => import('./pages/tenant/StaffManagement').then(m => ({ default: m.StaffManagement })));
const TelegramIntegration = lazy(() => import('./pages/tenant/TelegramIntegration').then(m => ({ default: m.TelegramIntegration })));

/** Redirect awal berbasis role: terapis → portal staff, lainnya → overview admin. Mendukung resolusi URL legacy berbasis hash. */
const IndexRedirect: React.FC = () => {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) emitBootPhase('done');
  }, [loading, user]);
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f0f2f5]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
      </div>
    );
  }

  // Resiliensi URL legacy: jika pengguna datang dari notifikasi lama/bookmark ber-hash (e.g. /admin/#/live-chat?conversationId=...)
  if (typeof window !== 'undefined' && window.location.hash && window.location.hash.startsWith('#/')) {
    const rawHash = window.location.hash.slice(2);
    if (rawHash) {
      return <Navigate to={`/admin/${rawHash}`} replace />;
    }
  }

  const targetPath = getDefaultRedirect(user?.role || '');
  return <Navigate to={targetPath} replace />;
};

// Prefetch chunk bundle halaman inti saat CPU/jaringan browser sedang idle untuk navigasi instan
const preloadCoreRouteBundles = () => {
  if (typeof window === 'undefined') return;
  const load = () => {
    import('./pages/tenant/LiveChatMonitor').catch(() => {});
    import('./pages/tenant/Reservations').catch(() => {});
    import('./pages/tenant/CustomerDatabase').catch(() => {});
    import('./pages/tenant/TodayTreatments').catch(() => {});
    import('./pages/tenant/Settings').catch(() => {});
    import('./pages/staff/StaffToday').catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1500);
  }
};

export const App: React.FC = () => {
  useEffect(() => {
    preloadCoreRouteBundles();
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <UiFeedbackProvider>
        <BootProgress />
        <Suspense fallback={
          <div className="flex h-screen items-center justify-center bg-[#f0f2f5]">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
          </div>
        }>
          <Routes>
            {/* Public routes */}
            <Route path="/admin/login" element={<Login />} />
            
            {/* Protected tenant admin dashboard routes */}
            <Route path="/admin/overview" element={
              <ProtectedRoute>
                <Layout>
                  <Overview />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/customers" element={
              <ProtectedRoute>
                <Layout>
                  <CustomerDatabase />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/labels" element={
              <ProtectedRoute>
                <Layout>
                  <CustomerLabels />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/customer-labels" element={<Navigate to="/admin/labels" replace />} />
            <Route path="/admin/customer-service" element={
              <ProtectedRoute>
                <Layout>
                  <CustomerService />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/cs" element={<Navigate to="/admin/customer-service" replace />} />

            <Route path="/admin/reservations" element={
              <ProtectedRoute>
                <Layout>
                  <Reservations />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/today-treatments" element={
              <ProtectedRoute>
                <Layout>
                  <TodayTreatments />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/today" element={<Navigate to="/admin/today-treatments" replace />} />
            <Route path="/admin/staff-management" element={
              <ProtectedRoute>
                <Layout>
                  <StaffManagement />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/staff" element={<Navigate to="/admin/staff-management" replace />} />

            <Route path="/admin/services" element={
              <ProtectedRoute>
                <Layout>
                  <ClinicServices />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/delivery" element={
              <ProtectedRoute>
                <Layout>
                  <DeliveryTiers />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/tiers" element={<Navigate to="/admin/delivery" replace />} />

            <Route path="/admin/follow-ups" element={
              <ProtectedRoute>
                <Layout>
                  <FollowUpQueue />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/follow-up-templates" element={
              <ProtectedRoute>
                <Layout>
                  <FollowUpTemplates />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/followup-templates" element={<Navigate to="/admin/follow-up-templates" replace />} />

            <Route path="/admin/knowledge-base" element={
              <ProtectedRoute>
                <Layout>
                  <KnowledgeBase />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/knowledge" element={<Navigate to="/admin/knowledge-base" replace />} />

            <Route path="/admin/chat-migration" element={
              <ProtectedRoute>
                <Layout>
                  <ChatMigration />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/migration" element={<Navigate to="/admin/chat-migration" replace />} />

            <Route path="/admin/sandbox" element={
              <ProtectedRoute>
                <Layout>
                  <AiSandbox />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/live-chat" element={
              <ProtectedRoute>
                <Layout>
                  <LiveChatMonitor />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/persona" element={
              <ProtectedRoute>
                <Layout>
                  <AiPersona />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/landing" element={
              <ProtectedRoute>
                <Layout>
                  <LandingPage />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/meta-click-catcher" element={
              <ProtectedRoute>
                <Layout>
                  <MetaClickCatcher />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/meta-clicks" element={<Navigate to="/admin/meta-click-catcher" replace />} />

            <Route path="/admin/meta-capi-queue" element={
              <ProtectedRoute>
                <Layout>
                  <MetaCapiQueue />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/meta-capi" element={<Navigate to="/admin/meta-capi-queue" replace />} />
            <Route path="/admin/capi-queue" element={<Navigate to="/admin/meta-capi-queue" replace />} />
            <Route path="/admin/capi" element={<Navigate to="/admin/meta-capi-queue" replace />} />

            <Route path="/admin/settings" element={
              <ProtectedRoute>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/telegram" element={
              <ProtectedRoute>
                <Layout>
                  <TelegramIntegration />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/ai-evaluations" element={
              <ProtectedRoute>
                <Layout>
                  <AiEvaluations />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/evaluations" element={<Navigate to="/admin/ai-evaluations" replace />} />

            <Route path="/admin/chat-export" element={
              <ProtectedRoute>
                <Layout>
                  <ChatExport />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/debug" element={
              <ProtectedRoute>
                <Layout>
                  <Debug />
                </Layout>
              </ProtectedRoute>
            } />

            {/* Unauthorized view */}
            <Route path="/admin/unauthorized" element={
              <div className="flex h-screen flex-col items-center justify-center bg-[#f0f2f5] text-[#111b21] text-center p-6 space-y-4">
                <div className="bg-white border border-[#e9edef] rounded-2xl p-8 shadow-xs max-w-sm flex flex-col items-center space-y-3">
                  <h3 className="text-lg font-bold text-rose-600">Access Unauthorized</h3>
                  <p className="text-xs text-[#667781]">
                    Anda tidak memiliki hak akses untuk membuka halaman ini.
                  </p>
                  <button
                    onClick={() => window.location.href = '/admin/login'}
                    className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] rounded-xl text-xs font-semibold text-white transition shadow-xs"
                  >
                    Kembali ke Halaman Login
                  </button>
                </div>
              </div>
            } />

            {/* Staff portal routes */}
            <Route path="/admin/staff/login" element={<Navigate to="/admin/login" replace />} />
            <Route path="/admin/staff/today" element={
              <StaffAuthProvider>
                <StaffProtectedRoute>
                  <StaffToday />
                </StaffProtectedRoute>
              </StaffAuthProvider>
            } />
            <Route path="/admin/staff/schedule" element={
              <StaffAuthProvider>
                <StaffProtectedRoute>
                  <StaffSchedule />
                </StaffProtectedRoute>
              </StaffAuthProvider>
            } />
            <Route path="/staff" element={<Navigate to="/admin/staff/today" replace />} />
            <Route path="/terapis" element={<Navigate to="/admin/staff/today" replace />} />
            <Route path="/chat" element={<Navigate to="/admin/staff/today" replace />} />
            <Route path="/schedule" element={<Navigate to="/admin/staff/schedule" replace />} />
            <Route path="/jadwal" element={<Navigate to="/admin/staff/schedule" replace />} />

            {/* Fallbacks */}
            <Route path="/admin" element={<IndexRedirect />} />
            <Route path="/admin/*" element={<IndexRedirect />} />
            <Route path="*" element={<IndexRedirect />} />
          </Routes>
        </Suspense>
        </UiFeedbackProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
