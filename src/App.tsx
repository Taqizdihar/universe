// File: src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLayout } from './layouts/AdminLayout';
import { SuperAdminLayout } from './layouts/SuperAdminLayout';
import { Dashboard } from './pages/Dashboard';
import { Pages } from './pages/Pages';
import { Posts } from './pages/Posts';
import { Media } from './pages/Media';
import { Comments } from './pages/Comments';
import { Layout } from './pages/Layout';
import { Users } from './pages/Users';
import { Plugins } from './pages/Plugins';
import { ApiIntegration } from './pages/ApiIntegration';
import { ApiSandbox } from './pages/ApiSandbox';
import { Settings } from './pages/Settings';
import { HeadlessSettings } from './pages/HeadlessSettings';
import { LayoutManager } from './pages/LayoutManager';
import { PagesEditor } from './pages/PagesEditor';
import { HeadlessPosts } from './pages/HeadlessPosts';
import { LandingPagePreview } from './pages/LandingPagePreview';
import { UpdateHistory } from './pages/UpdateHistory';
import { FaqCenter } from './pages/FaqCenter';
import { Notifications } from './pages/Notifications';
import { Inquiries } from './pages/Inquiries';
import { Profile } from './pages/Profile';
import { LogAktivitas } from './pages/LogAktivitas';
import { Panduan } from './pages/Panduan';
import { SuperAdminDashboard } from './pages/SuperAdminDashboard';
import { TenantManagement } from './pages/TenantManagement';
import { GlobalFaqManager } from './pages/GlobalFaqManager';
import { InfrastructureMonitor } from './pages/InfrastructureMonitor';
import { UpdateHistoryManager } from './pages/UpdateHistoryManager';
import { SuperAdminSettings } from './pages/SuperAdminSettings';
import { SuperAdminRoute } from './components/SuperAdminRoute';
import { SearchProvider } from './context/SearchContext';
import { CMSProvider } from './context/CMSContext';
import { HeadlessCmsProvider } from './context/HeadlessCmsContext';

// Auth Pages
import { PublicLanding } from './pages/PublicLanding';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { SuperAdminRecovery } from './pages/SuperAdminRecovery';
import { Register } from './pages/Register';
import { Setup } from './pages/Setup';
import { PublicView } from './pages/PublicView';
import { ProtectedRoute } from './components/ProtectedRoute';

export default function App() {
  return (
    <CMSProvider>
      <HeadlessCmsProvider>
        <SearchProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<PublicLanding />} />
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/super-admin/recovery" element={<SuperAdminRecovery />} />
              <Route path="/register" element={<Register />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/preview/:subdomain/:slug?" element={<PublicView />} />
              <Route path="/post/:subdomain/:slug" element={<PublicView />} />

              {/* Protected CMS Routes */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AdminLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/pages" element={<Pages />} />
                  <Route path="/posts" element={<Posts />} />
                  <Route path="/media" element={<Media />} />
                  <Route path="/comments" element={<Comments />} />
                  <Route path="/layout" element={<Layout />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/plugins" element={<Plugins />} />
                  <Route path="/api-integration" element={<ApiIntegration />} />
                  <Route path="/api-sandbox" element={<ApiSandbox />} />
                  <Route path="/settings" element={<Settings />} />
                  
                  {/* Headless Testing Routes */}
                  <Route path="/headless-settings" element={<HeadlessSettings />} />
                  <Route path="/headless-layout" element={<LayoutManager />} />
                  <Route path="/headless-pages" element={<PagesEditor />} />
                  <Route path="/headless-posts" element={<HeadlessPosts />} />
                  <Route path="/headless-preview" element={<LandingPagePreview />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/dashboard/updates" element={<UpdateHistory />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/inquiries" element={<Inquiries />} />
                  <Route path="/faq" element={<FaqCenter />} />
                  <Route path="/log-aktivitas" element={<LogAktivitas />} />
                  <Route path="/panduan" element={<Panduan />} />
                </Route>
              </Route>

              {/* Super Admin Routes */}
              <Route element={<ProtectedRoute />}>
                <Route element={<SuperAdminRoute />}>
                   <Route element={<SuperAdminLayout />}>
                     <Route path="/super-admin/dashboard" element={<SuperAdminDashboard />} />
                     <Route path="/super-admin/tenants" element={<TenantManagement />} />
                     <Route path="/super-admin/faq" element={<GlobalFaqManager />} />
                     <Route path="/super-admin/infrastructure" element={<InfrastructureMonitor />} />
                     <Route path="/super-admin/updates" element={<UpdateHistoryManager />} />
                     <Route path="/super-admin/settings" element={<SuperAdminSettings />} />
                   </Route>
                </Route>
              </Route>

              {/* Catch All */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SearchProvider>
      </HeadlessCmsProvider>
    </CMSProvider>
  );
}
