import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { canAccess, type ModuleKey } from '@sms/shared';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ScopeProvider } from './lib/scope';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ModulePlaceholder } from './pages/ModulePlaceholder';
import { Branches } from './pages/Branches';
import { Setup } from './pages/Setup';
import { Staff } from './pages/Staff';
import { StudentDetail, Students } from './pages/Students';
import { Import } from './pages/Import';
import { Admissions } from './pages/Admissions';
import { Attendance } from './pages/Attendance';
import { Fees } from './pages/Fees';
import { ReceiptPage } from './pages/Collection';
import { DevCheckout, PaymentResult } from './pages/Payments';
import { Communication, Notifications } from './pages/Notifications';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function RequireUser({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  return status === 'signed-in' ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Same RBAC as the sidebar; the API enforces it again on every request. */
function Guard({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !canAccess(module, user.role)) return <ModulePlaceholder forced={module} />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireUser>
                  <ScopeProvider>
                    <Layout />
                  </ScopeProvider>
                </RequireUser>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/branches" element={<Guard module="branches"><Branches /></Guard>} />
              <Route path="/setup" element={<Guard module="setup"><Setup /></Guard>} />
              <Route path="/staff" element={<Guard module="staff"><Staff /></Guard>} />
              <Route path="/students" element={<Guard module="students"><Students /></Guard>} />
              <Route path="/students/:id" element={<Guard module="students"><StudentDetail /></Guard>} />
              <Route path="/admissions" element={<Guard module="admissions"><Admissions /></Guard>} />
              <Route path="/attendance" element={<Guard module="attendance"><Attendance /></Guard>} />
              <Route path="/fees" element={<Guard module="fees"><Fees /></Guard>} />
              <Route path="/receipts/:id" element={<Guard module="fees"><ReceiptPage /></Guard>} />
              <Route path="/pay/dev/:orderId" element={<Guard module="fees"><DevCheckout /></Guard>} />
              <Route path="/pay/result/:orderId" element={<Guard module="fees"><PaymentResult /></Guard>} />
              <Route path="/import/:kind" element={<Guard module="students"><Import /></Guard>} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/communication" element={<Guard module="communication"><Communication /></Guard>} />
              <Route path="/:module" element={<ModulePlaceholder />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
