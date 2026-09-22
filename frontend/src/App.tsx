import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigate, Outlet, Route, BrowserRouter, Routes, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { ToastProvider } from '@/components/ui'
import { DashboardPage } from '@/pages/Dashboard'
import { EmployeesPage } from '@/pages/Employees'
import { LoginPage } from '@/pages/Login'
import { NotificationsPage } from '@/pages/Notifications'
import { PayrollPage } from '@/pages/Payroll'
import { SchedulesPage } from '@/pages/Schedules'
import { SettingsPage } from '@/pages/Settings'
import { TasksPage } from '@/pages/Tasks'
import { TimesheetPage } from '@/pages/Timesheet'
import { TodayPage } from '@/pages/Today'
import { WorkplacePage } from '@/pages/Workplace'
import { useAuth } from '@/store/auth'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } })

function TenantGuard() {
  const { slug } = useParams()
  const { token, slug: authSlug, setSlug } = useAuth()
  useEffect(() => { if (slug && slug !== authSlug) setSlug(slug) }, [slug, authSlug, setSlug])
  if (!token || (authSlug && authSlug !== slug)) return <Navigate to={`/${slug}/login`} replace />
  return <AppLayout />
}

function TenantLogin() {
  const { slug } = useParams()
  const { token, slug: authSlug, setSlug } = useAuth()
  useEffect(() => { if (slug) setSlug(slug) }, [slug, setSlug])
  if (token && authSlug === slug) return <Navigate to={`/${slug}`} replace />
  return <LoginPage />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/workplace/*" element={<WorkplacePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/:slug/login" element={<TenantLogin />} />
            <Route path="/:slug" element={<TenantGuard />}>
              <Route index element={<DashboardPage />} />
              <Route path="today" element={<TodayPage />} />
              <Route path="structure" element={<Navigate to="../employees?tab=structure" replace />} />
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="schedules" element={<SchedulesPage />} />
              <Route path="timesheet" element={<TimesheetPage />} />
              <Route path="payroll" element={<PayrollPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="" replace />} />
            </Route>
            <Route path="/" element={<RootRedirect />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

function RootRedirect() {
  const { slug } = useAuth()
  return <Navigate to={slug ? `/${slug}` : '/login'} replace />
}

export { Outlet }
