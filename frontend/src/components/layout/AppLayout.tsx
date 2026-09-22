import { useQuery } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { Bell, CalendarClock, CalendarDays, ClipboardList, Home, ListChecks, LogOut, Menu, Moon, Palette, PanelLeftClose, PanelLeftOpen, Search, Settings, Sun, Users, Wallet, X, Languages } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CommandSearch } from '@/components/CommandSearch'
import { EmployeeDrawer } from '@/pages/EmployeeDrawer'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { useAuth, useUi } from '@/store/auth'
import { applyBrandColor } from '@/lib/brand'

const THEMES = ['arctic', 'daybreak', 'pearl', 'mint', 'sky', 'meadow', 'lilac', 'rose']

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { slug, displayName, role, logout, branchName } = useAuth()
  const { theme, mode, sidebarOpen, sidebarCollapsed, setTheme, setMode, toggleSidebar, toggleCollapsed } = useUi()
  const nav = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [openEmp, setOpenEmp] = useState<number | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); useUi.getState().toggleCollapsed() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data, staleTime: 60_000 })
  const pendingReq = useQuery({ queryKey: ['pending-requests'], queryFn: async () => (await api.get('/absence-requests/pending-count')).data.count as number, refetchInterval: 60_000 })
  const pendingSubs = useQuery({ queryKey: ['pending-subs'], queryFn: async () => (await api.get('/attendance-feed-subscribers/pending-count')).data.count as number, refetchInterval: 60_000 })
  const license = useQuery({ queryKey: ['license'], queryFn: async () => (await api.get('/license')).data, staleTime: 300_000 })

  useEffect(() => {
    const s = settings.data?.settings
    if (s?.site_theme && s.site_theme !== theme) setTheme(s.site_theme)
    // tenant language is the default; a language the user picked in the sidebar (localStorage) wins
    if (s?.language && !localStorage.getItem('faceid-lang') && s.language !== i18n.language) i18n.changeLanguage(s.language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data])

  const s = settings.data?.settings ?? {}
  const items = [
    { to: '', icon: Home, label: t('nav.dashboard'), end: true },
    { to: 'today', icon: CalendarClock, label: t('nav.today') },
    { to: 'employees', icon: Users, label: t('nav.employees') },
    { to: 'schedules', icon: CalendarDays, label: t('nav.schedules') },
    { to: 'timesheet', icon: ClipboardList, label: t('nav.timesheet') },
    ...(s.finance_enabled !== false ? [{ to: 'payroll', icon: Wallet, label: t('nav.payroll') }] : []),
    ...(s.tasks_enabled ? [{ to: 'tasks', icon: ListChecks, label: t('nav.tasks') }] : []),
    { to: 'notifications', icon: Bell, label: t('nav.notifications'), badge: (pendingReq.data ?? 0) + (pendingSubs.data ?? 0) },
    { to: 'settings', icon: Settings, label: t('nav.settings') },
  ]

  const cycleTheme = async () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    if (role === 'admin') api.put('/settings', { settings: { site_theme: next } }).catch(() => {})
  }
  const toggleLang = () => {
    const next = i18n.language === 'ru' ? 'uz' : 'ru'
    i18n.changeLanguage(next)
    localStorage.setItem('faceid-lang', next)
  }

  // `mini` = icon rail on desktop; the mobile drawer always renders the full sidebar
  const renderSidebar = (mini: boolean) => (
    <aside className={clsx('flex h-full flex-col bg-sidebar transition-[width] duration-200', mini ? 'w-[80px]' : 'w-[280px]')}>
      <div className={clsx('py-4 flex items-center gap-3', mini ? 'px-0 justify-center' : 'px-5')}>
        <div className="h-10 w-10 rounded-full bg-accent text-white flex items-center justify-center text-base font-medium shrink-0" title={settings.data?.company_name ?? slug}>F</div>
        {!mini && <div className="min-w-0"><div className="font-semibold text-ink truncate">{settings.data?.company_name ?? slug}</div><div className="text-xs text-muted truncate">{branchName ?? tr("Главный офис")} · {role}</div></div>}
        {!mini && <button className="btn-ghost btn-sm ml-auto lg:hidden" onClick={() => toggleSidebar(false)}><X className="h-4 w-4" /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pt-2 space-y-0.5">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to ? `/${slug}/${it.to}` : `/${slug}`} end={it.end} onClick={() => toggleSidebar(false)} title={mini ? it.label : undefined}
            className={({ isActive }) => clsx('relative flex items-center gap-3 rounded-full h-14 text-sm transition m3-state', mini ? 'justify-center px-0' : 'px-4', isActive ? 'bg-accent-soft text-ink font-semibold' : 'text-muted font-medium hover:text-ink')}>
            {({ isActive }) => (<>
              <it.icon className={clsx("h-6 w-6 shrink-0", isActive && "text-accent")} strokeWidth={isActive ? 2.25 : 2} />{!mini && <span className="flex-1">{it.label}</span>}
              {!!it.badge && (mini ? <span className="absolute top-1 right-2 h-2 w-2 rounded-full bg-danger ring-2 ring-card" /> : <span className={clsx('text-[11px] font-semibold rounded-full px-1.5 py-px min-w-5 text-center', 'bg-danger text-white')}>{it.badge}</span>)}
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className={clsx('p-3', mini ? 'space-y-1' : 'space-y-2')}>
        {!mini && license.data && <div className="px-1 text-xs text-subtle">{license.data.plan_name} · {license.data.employee_count}/{license.data.max_employees} {tr("сотр.")}{license.data.days_remaining !== null && <span className={clsx(license.data.days_remaining < 15 && 'text-danger')}> · {license.data.days_remaining} {tr("дн.")}</span>}</div>}
        <div className={clsx('flex items-center gap-1', mini ? 'flex-col' : 'justify-center')}>
          <button className="btn-ghost btn-sm !px-2 !text-muted" title={tr("Уведомления")} onClick={() => nav(`/${slug}/notifications`)}><Bell className="h-4 w-4" /></button>
          <button className="btn-ghost btn-sm !px-2 !text-muted" title={tr("Тёмная тема")} onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>{mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          <button className="btn-ghost btn-sm !px-2 !text-muted" title={tr("Тема")} onClick={cycleTheme}><Palette className="h-4 w-4" /></button>
          <button className="btn-ghost btn-sm !px-2 !text-muted" title={tr("Язык")} onClick={toggleLang}><Languages className="h-4 w-4" />{!mini && <span className="text-xs uppercase">{i18n.language}</span>}</button>
          <button className="btn-ghost btn-sm !px-2 !text-muted hidden lg:inline-flex" title={(sidebarCollapsed ? tr("Развернуть меню") : tr("Свернуть меню")) + ' (Ctrl B)'} onClick={() => toggleCollapsed()}>{sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
        </div>
        <button className={clsx('m3-state w-full flex items-center justify-center gap-2 rounded-full border border-subtle text-danger font-medium h-10 transition cursor-pointer', mini ? 'px-0' : 'px-4 text-sm')} title={t('nav.logout')} onClick={() => { logout(); nav(`/${slug}/login`) }}><LogOut className="h-4.5 w-4.5" />{!mini && t('nav.logout')}</button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-full">
      <div className="hidden lg:block shrink-0">{renderSidebar(sidebarCollapsed)}</div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => toggleSidebar(false)} />
          <div className="absolute inset-y-0 left-0 animate-fade-in">{renderSidebar(false)}</div>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center gap-3 px-4 h-16 bg-sidebar sticky top-0 z-30">
          <button className="btn-ghost btn-sm !px-2 !text-ink" onClick={() => toggleSidebar(true)} aria-label={tr("Открыть меню")}><Menu className="h-6 w-6" /></button>
          <div className="text-[22px] font-normal text-ink truncate">{settings.data?.company_name ?? slug}</div>
          <button className="ml-auto btn-ghost btn-sm !px-2 !text-ink" onClick={() => setSearchOpen(true)}><Search className="h-6 w-6" /></button>
        </header>
        {license.data?.access_blocked && <div className="bg-danger text-white text-sm px-4 py-2 text-center">{tr("Доступ ограничен:")} {license.data.block_reason}</div>}
        <main key={i18n.language} className="flex-1 overflow-y-auto app-bg"><div className="p-4 lg:px-10 lg:py-8 max-w-[1400px] w-full mx-auto"><Outlet /></div></main>
      </div>
      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenEmployee={setOpenEmp} />
      {openEmp && <EmployeeDrawer employeeId={openEmp} onClose={() => setOpenEmp(null)} />}
    </div>
  )
}
