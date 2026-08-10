import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { Layout } from './components/common/Layout';
import { UiFeedbackProvider } from './components/common/UiFeedback';
import { Login } from './pages/auth/Login';

// Lazy load pages for fast initial bundle sizes (code-splitting rationale)
const Overview = lazy(() => import('./pages/tenant/Overview').then(m => ({ default: m.Overview })));
const Reservations = lazy(() => import('./pages/tenant/Reservations').then(m => ({ default: m.Reservations })));
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
const CustomerService = lazy(() => import('./pages/tenant/CustomerService').then(m => ({ default: m.CustomerService })));
const AiEvaluations = lazy(() => import('./pages/tenant/AiEvaluations').then(m => ({ default: m.AiEvaluations })));
const MetaClickCatcher = lazy(() => import('./pages/tenant/MetaClickCatcher').then(m => ({ default: m.MetaClickCatcher })));
const MetaCapiQueue = lazy(() => import('./pages/tenant/MetaCapiQueue').then(m => ({ default: m.MetaCapiQueue })));

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UiFeedbackProvider>
        <Suspense fallback={
          <div className="flex h-screen items-center justify-center bg-slate-950">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-pink-500 border-t-transparent"></div>
          </div>
        }>
          <Routes>
            {/* Public routes */}
            <Route path="/admin/login" element={<Login />} />
            
            {/* Protected tenant admin dashboard routes */}
            <Route path="/admin/overview" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <Overview />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/customers" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <CustomerDatabase />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/reservations" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <Reservations />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/knowledge-base" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <KnowledgeBase />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/sandbox" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <AiSandbox />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/live-chat" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <LiveChatMonitor />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/services" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <ClinicServices />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/delivery" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <DeliveryTiers />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/follow-ups" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <FollowUpQueue />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/follow-up-templates" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <FollowUpTemplates />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/persona" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <AiPersona />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/debug" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <Debug />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/settings" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/landing" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <LandingPage />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/customer-service" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <CustomerService />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/ai-evaluations" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <AiEvaluations />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/meta-click-catcher" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <MetaClickCatcher />
                </Layout>
              </ProtectedRoute>
            } />
            <Route path="/admin/meta-capi-queue" element={
              <ProtectedRoute allowedRoles={['tenant_admin', 'super_admin']}>
                <Layout>
                  <MetaCapiQueue />
                </Layout>
              </ProtectedRoute>
            } />

            {/* Unauthorized view */}
            <Route path="/admin/unauthorized" element={
              <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-slate-100 text-center p-6 space-y-4">
                <h3 className="text-xl font-bold text-rose-500">Access Unauthorized</h3>
                <p className="text-sm text-slate-400 max-w-sm">
                  You do not have permission to access this page or the selected tenant resource.
                </p>
                <button
                  onClick={() => window.location.href = '/admin/login'}
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 rounded-xl text-xs font-bold text-white transition"
                >
                  Return to Login
                </button>
              </div>
            } />

            {/* Fallbacks */}
            <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
            <Route path="/admin/*" element={<Navigate to="/admin/overview" replace />} />
            <Route path="*" element={<Navigate to="/admin/overview" replace />} />
          </Routes>
        </Suspense>
        </UiFeedbackProvider>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
