import { useQuery } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { AlertTriangle, BarChart3, Cake, Clock, Laptop, UserCheck, UserX, Users, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/api/client'
import { Avatar, Empty, Kpi, Modal, Spinner, StatusBadge, Tabs } from '@/components/ui'
import { fmtDate, fmtDateTime, fmtTime, hmHuman, money, signedMoney } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { TransactionModal } from './Payroll'

const COLORS = ['#22c55e', '#f59e0b', '#f43f5e', '#0ea5e9']

export function DashboardPage() {
  const { t } = useTranslation()
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data })
  const [view, setView] = useState<'attendance' | 'finance'>((localStorage.getItem('dash-view') as 'attendance' | 'finance') || settings.data?.settings?.dashboard_view || 'attendance')
  const finance = settings.data?.settings?.finance_enabled !== false
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {finance && <Tabs value={view} onChange={(v) => { setView(v); localStorage.setItem('dash-view', v) }} items={[{ value: 'finance', label: <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4" />{t('dashboard.finance')}</span> }, { value: 'attendance', label: <span className="flex items-center gap-1.5"><BarChart3 className="h-4 w-4" />{t('dashboard.attendance')}</span> }]} />}
      </div>
      {view === 'finance' && finance ? <FinanceView /> : <AttendanceView />}
    </div>
  )
}

function Ring({ value, label, sub, size = 132 }: { value: number; label: string; sub: string; size?: number }) {
  const v = Math.min(100, Math.max(0, value))
  const color = v < 50 ? 'var(--danger)' : v < 80 ? 'var(--warning)' : 'var(--success)'
  const grade = v < 50 ? tr("Низкий показатель") : v < 80 ? tr("Средний показатель") : tr("Высокий показатель")
  const r = 42, c = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="9" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><div className="text-[26px] font-bold leading-none tabular-nums">{Math.round(v)}<span className="text-sm text-muted font-medium">%</span></div><div className="text-[11px] text-muted mt-1 tabular-nums">{sub}</div></div>
      </div>
      <div className="mt-2 font-semibold text-sm">{label}</div>
      <div className="text-xs" style={{ color }}>{grade}</div>
    </div>
  )
}

const DEP_COLORS = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#0891b2', '#db2777', '#65a30d', '#f59e0b']

function AttendanceView() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { slug } = useAuth()
  const [passesOpen, setPassesOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState<Status | null>(null)
  const q = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get('/dashboard/bootstrap?passes_limit=20')).data, refetchInterval: 60_000 })
  const trend = useQuery({ queryKey: ['analytics'], queryFn: async () => (await api.get('/dashboard/analytics?days=14')).data })
  if (q.isLoading || !q.data) return <Spinner />
  const s = q.data.summary
  const goToday = () => nav(`/${slug}/today`)
  const rate = (n: number) => (s.attendance_total ? Math.round((n / s.attendance_total) * 1000) / 10 : 0)
  const dist: { key: Status; name: string; value: number; color: string }[] = [{ key: 'present', name: t('dashboard.present'), value: s.present, color: '#22c55e' }, { key: 'late', name: t('dashboard.late'), value: s.late, color: '#f59e0b' }, { key: 'absent', name: t('dashboard.absent'), value: s.absent, color: '#f43f5e' }, { key: 'remote', name: t('dashboard.remote'), value: s.remote, color: '#0ea5e9' }]
  const avg = s.departments.length ? Math.round(s.departments.reduce((a: number, d: { attendance_rate: number }) => a + d.attendance_rate, 0) / s.departments.length) : 0
  type Dep = { department_name: string; total: number; present: number; late: number; absent: number; remote: number; attendance_rate: number }
  type Pass = { employee_id: number; employee_name: string; avatar_url: string | null; check_in_at: string; check_out_at: string | null; is_inside: boolean }
  type Problem = { employee_id: number; full_name: string; avatar_url: string | null; position: string; absent_days: number; late_count: number; early_count: number }
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label={t('dashboard.totalEmployees')} value={s.total} icon={<Users />} onClick={() => nav(`/${slug}/employees`)} />
        <Kpi label={t('dashboard.attendance')} value={s.present + s.late + s.remote} sub={`${s.attendance_rate}%`} tone="success" icon={<UserCheck />} onClick={() => setStatusOpen('present')} />
        <Kpi label={t('dashboard.late')} value={s.late} sub={`${rate(s.late)}%`} tone="warning" icon={<Clock />} onClick={() => setStatusOpen('late')} />
        <Kpi label={t('dashboard.absent')} value={s.absent} sub={`${rate(s.absent)}%`} tone="danger" icon={<UserX />} onClick={() => setStatusOpen('absent')} />
        <Kpi label={t('dashboard.remote')} value={s.remote} sub={`${rate(s.remote)}%`} tone="info" icon={<Laptop />} onClick={() => setStatusOpen('remote')} />
      </div>
      <div className="grid lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-3">
          <div className="card p-5">
            <h2 className="text-base font-semibold mb-4">{t('dashboard.resultToday')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Ring value={s.attendance_rate} label={t('dashboard.attendance')} sub={`${s.present + s.late + s.remote} / ${s.attendance_total}`} />
              <Ring value={s.punctuality_rate} label={t('dashboard.onTime')} sub={`${s.present} / ${s.attendance_total}`} />
            </div>
            {s.attendance_total > 0 && (
              <div className="mt-5">
                <div className="flex h-2.5 rounded-full overflow-hidden bg-elevated">
                  {dist.filter((d) => d.value > 0).map((d) => <div key={d.name} style={{ width: `${(d.value / s.attendance_total) * 100}%`, background: d.color }} title={`${d.name}: ${d.value}`} />)}
                </div>
                <div className="mt-3 grid grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2">
                  {dist.map((d) => (
                    <button key={d.key} type="button" onClick={() => setStatusOpen(d.key)} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 -mx-2 hover:bg-elevated transition cursor-pointer text-left"><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} /><span className="text-muted">{d.name}</span><span className="ml-auto font-semibold tabular-nums">{d.value}</span></button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="text-base font-semibold">{t('dashboard.byDepartment')}</h2>
              <span className="text-sm text-muted">{t('dashboard.avgAttendance')} <b className={clsx('text-base ml-1', avg >= 80 ? 'text-success' : avg >= 50 ? 'text-warning' : 'text-danger')}>{avg}%</b></span></div>
            <div className="grid xl:grid-cols-2 gap-3">
              {s.departments.map((d: Dep, i: number) => (
                <div key={d.department_name} className="rounded-xl border border-line p-4 cursor-pointer hover:border-accent/50 transition" onClick={goToday}>
                  <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 font-semibold truncate"><span className="h-3 w-3 rounded-full shrink-0" style={{ background: DEP_COLORS[i % DEP_COLORS.length] }} />{d.department_name}</div><span className={clsx('font-bold tabular-nums', d.attendance_rate >= 80 ? 'text-success' : d.attendance_rate >= 50 ? 'text-warning' : 'text-danger')}>{d.attendance_rate}%</span></div>
                  <div className="h-1.5 rounded-full bg-elevated overflow-hidden mb-3"><div className="h-full rounded-full" style={{ width: `${d.attendance_rate}%`, background: DEP_COLORS[i % DEP_COLORS.length] }} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    {[[t('dashboard.totalEmployees'), d.total, ''], [t('dashboard.onTime'), d.present, 'text-success'], [t('dashboard.late'), d.late, 'text-warning'], [t('dashboard.absent'), d.absent, 'text-danger']].map(([l, v, c]) => (
                      <div key={String(l)} className="rounded-lg border border-line bg-elevated/60 px-3 py-2"><div className="text-[10px] uppercase tracking-wider text-muted font-semibold leading-tight">{l}</div><div className={clsx('text-lg font-bold tabular-nums leading-tight', Number(v) ? c : '')}>{v}</div></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {!s.departments.length && <Empty />}
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3"><h2 className="text-base font-semibold">{t('dashboard.trend')}</h2><span className="text-xs text-muted">{tr("14 дней")}</span></div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data?.series ?? []} margin={{ left: -24, right: 4, top: 8 }}>
                  <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity={0.18} /><stop offset="1" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(8)} fontSize={11} stroke="var(--text-subtle)" tickLine={false} axisLine={false} /><YAxis fontSize={11} stroke="var(--text-subtle)" allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area type="monotone" dataKey="present" name={t('dashboard.present')} stroke="var(--accent)" fill="url(#g1)" strokeWidth={2} />
                  <Area type="monotone" dataKey="late" name={t('dashboard.late')} stroke="var(--warning)" fill="transparent" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="absent" name={t('dashboard.absent')} stroke="var(--danger)" fill="transparent" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="card p-5">
            <h2 className="text-base font-semibold mb-3">{t('dashboard.distribution')}</h2>
            <div className="rounded-xl p-3" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}>
              <div className="h-48 relative">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={dist.filter((d) => d.value > 0)} dataKey="value" innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">{dist.filter((d) => d.value > 0).map((d) => <Cell key={d.name} fill={d.color} />)}</Pie></PieChart></ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white pointer-events-none"><div className="text-3xl font-bold leading-none">{s.attendance_total}</div><div className="text-[10px] uppercase tracking-widest opacity-70 mt-1">{t('common.total')}</div></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {dist.map((d) => (
                <button key={d.key} type="button" onClick={() => setStatusOpen(d.key)} className="rounded-xl border border-line px-3 py-2 text-left hover:border-accent/50 hover:bg-accent-soft/40 transition cursor-pointer">
                  <div className="flex items-center gap-2 text-xs text-muted"><span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.color }} /><span className="truncate">{d.name}</span></div>
                  <div className="flex items-baseline gap-1.5 mt-1"><span className="text-lg font-bold tabular-nums leading-none">{d.value}</span><span className="text-[11px] text-muted">{rate(d.value)}%</span></div>
                </button>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2 mb-1"><h2 className="text-base font-semibold">{t('dashboard.lastPasses')}</h2><button className="text-xs text-accent font-medium cursor-pointer hover:underline shrink-0 whitespace-nowrap" onClick={() => setPassesOpen(true)}>{t('dashboard.showAll')}</button></div>
            <div className="text-xs text-muted mb-3 flex items-center gap-1.5 flex-wrap"><b className="text-ink">{q.data.passes.at_work_now}</b> {t('dashboard.atWork')} · <b className="text-ink">{q.data.passes.left_today}</b> {tr("ушли")} <span className="badge-green !py-0 !text-[10px] uppercase">{tr("онлайн")}</span></div>
            <div className="divide-y divide-line">
              {q.data.passes.passes.slice(0, 7).map((p: Pass) => (
                <div key={p.employee_id} className="flex items-center gap-3 py-2.5 text-sm"><Avatar name={p.employee_name} src={p.avatar_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{p.employee_name}</div>
                    <div className="text-xs tabular-nums"><span className="text-success font-medium">{fmtDate(p.check_in_at, 'dd.MM HH:mm')}</span>{p.check_out_at && <> → <span className="text-danger font-medium">{fmtDate(p.check_out_at, 'dd.MM HH:mm')}</span> <span className="text-muted">· {hmHuman(Math.round((+new Date(p.check_out_at) - +new Date(p.check_in_at)) / 60000))}</span></>}{!p.check_out_at && <span className="text-muted"> · {tr("на работе")}</span>}</div>
                  </div>
                </div>
              ))}
              {!q.data.passes.passes.length && <Empty text={tr("Сегодня проходов нет")} />}
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3"><h2 className="text-base font-semibold">{t('dashboard.problematic')}</h2><span className="text-xs text-muted">{t('dashboard.perMonth')}</span></div>
            {q.data.problematic.length ? <div className="space-y-2.5">{q.data.problematic.slice(0, 5).map((p: Problem) => (
              <div key={p.employee_id} className="flex items-center gap-2.5 text-sm cursor-pointer" onClick={() => nav(`/${slug}/employees?open=${p.employee_id}`)}><Avatar name={p.full_name} src={p.avatar_url} size={32} />
                <div className="min-w-0 flex-1 truncate">{p.full_name}</div>
                <span className="text-xs text-muted whitespace-nowrap">{[p.absent_days ? tr("{{v0}} прог.", { v0: p.absent_days }) : null, p.late_count ? tr("{{v0}} опозд.", { v0: p.late_count }) : null].filter(Boolean).join(' · ')}</span></div>
            ))}</div> : <div className="text-sm text-muted">{t('dashboard.allGood')}</div>}
          </div>
        </div>
      </div>
      <PassesModal open={passesOpen} onClose={() => setPassesOpen(false)} />
      <StatusModal status={statusOpen} onClose={() => setStatusOpen(null)} />
    </>
  )
}

type Status = 'present' | 'late' | 'absent' | 'remote'
type TodayItem = { employee_id: number; full_name: string; avatar_url: string | null; position: string | null; department_name: string | null; check_in_time: string | null; check_out_time: string | null; late_minutes: number; problem_reason: string | null }

/** Employee list for one status of today (opened from KPI tiles / distribution) */
function StatusModal({ status, onClose }: { status: Status | null; onClose: () => void }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { slug } = useAuth()
  const q = useQuery({ queryKey: ['today-lists'], queryFn: async () => (await api.get('/attendance/today')).data, enabled: !!status, staleTime: 30_000 })
  const titles: Record<Status, string> = { present: t('dashboard.present'), late: t('dashboard.late'), absent: t('dashboard.absent'), remote: t('dashboard.remote') }
  const items: TodayItem[] = status && q.data ? (q.data[`${status}_list`] ?? []) : []
  return (
    <Modal open={!!status} onClose={onClose} title={status ? `${titles[status]} · ${items.length}` : ''} size="md">
      {q.isLoading ? <Spinner /> : (
        <div className="divide-y divide-line -my-1">
          {items.map((x) => (
            <div key={x.employee_id} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-elevated -mx-2 px-2 rounded-lg" onClick={() => { onClose(); nav(`/${slug}/employees?open=${x.employee_id}`) }}>
              <Avatar name={x.full_name} src={x.avatar_url} size={36} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{x.full_name}</div><div className="text-xs text-muted truncate">{[x.position, x.department_name].filter(Boolean).join(' · ') || '—'}</div></div>
              <div className="text-right text-xs tabular-nums shrink-0">
                {status === 'absent' ? <span className="text-danger">{x.problem_reason ?? tr("не пришёл")}</span>
                  : <><span className="text-success font-medium">{x.check_in_time ?? '—'}</span>{x.check_out_time && <span className="text-muted"> → {x.check_out_time}</span>}{status === 'late' && x.late_minutes > 0 && <div className="text-warning">+{hmHuman(x.late_minutes)}</div>}</>}
              </div>
            </div>
          ))}
          {!items.length && <Empty />}
        </div>
      )}
    </Modal>
  )
}

function PassesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'all' | 'inside' | 'left'>('all')
  const q = useQuery({ queryKey: ['passes-all'], queryFn: async () => (await api.get('/attendance/passes?limit=500')).data, enabled: open })
  const items = (q.data?.passes ?? []).filter((p: { is_inside: boolean }) => tab === 'all' || (tab === 'inside' ? p.is_inside : !p.is_inside))
  return (
    <Modal open={open} onClose={onClose} title={tr("Все проходы сегодня")} subtitle={q.data && tr("На работе: {{v0}} · Ушли: {{v1}}", { v0: q.data.at_work_now, v1: q.data.left_today })} size="lg">
      <Tabs value={tab} onChange={setTab} className="mb-3" items={[{ value: 'all', label: tr("Все"), count: q.data?.passes.length }, { value: 'inside', label: tr("На работе"), count: q.data?.at_work_now }, { value: 'left', label: tr("Вышли"), count: q.data?.left_today }]} />
      <table className="table"><thead><tr><th>{tr("Сотрудник")}</th><th>{tr("Вход")}</th><th>{tr("Выход")}</th><th>{tr("Длительность")}</th><th>{tr("Статус")}</th></tr></thead><tbody>
        {items.map((p: { employee_id: number; employee_name: string; avatar_url: string | null; check_in_at: string; check_out_at: string | null; duration_minutes: number | null; is_inside: boolean }) => (
          <tr key={p.employee_id}><td><div className="flex items-center gap-2"><Avatar name={p.employee_name} src={p.avatar_url} size={32} /><div><div className="font-medium">{p.employee_name}</div><div className="text-xs text-muted">ID: {p.employee_id}</div></div></div></td>
            <td className="tabular-nums">{fmtDateTime(p.check_in_at)}</td><td className="tabular-nums">{p.check_out_at ? fmtDateTime(p.check_out_at) : '—'}</td><td>{p.duration_minutes != null ? hmHuman(p.duration_minutes) : '—'}</td><td><span className={p.is_inside ? 'badge-green' : 'badge-gray'}>{p.is_inside ? tr("на работе") : tr("ушёл")}</span></td></tr>
        ))}
      </tbody></table>
      {!items.length && <Empty />}
    </Modal>
  )
}

function FinanceView() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { slug } = useAuth()
  const [modal, setModal] = useState<null | 'salary' | 'bonus' | 'fine'>(null)
  const kpi = useQuery({ queryKey: ['kpi'], queryFn: async () => (await api.get('/dashboard/kpi')).data })
  const tx = useQuery({ queryKey: ['tx-recent'], queryFn: async () => (await api.get('/payroll/transactions?per_page=8')).data })
  if (kpi.isLoading || !kpi.data) return <Spinner />
  const k = kpi.data
  const fund = [{ name: tr("Зарплата"), value: +k.total_salary }, { name: tr("Бонусы"), value: +k.total_bonuses }, { name: tr("Штрафы"), value: +k.total_fines }, { name: tr("Выплачено"), value: +k.paid_out }].filter((x) => x.value > 0)
  const total = (+k.total_salary) + (+k.total_bonuses) + (+k.total_fines)
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={t('dashboard.totalEmployees')} value={k.total_employees} icon={<Users />} />
        <Kpi label={t('dashboard.attended')} value={k.present_today} tone="success" icon={<UserCheck />} />
        <Kpi label={t('dashboard.hoursWorked')} value={k.hours_worked} sub={tr("сегодня")} tone="info" icon={<Clock />} />
        <Kpi label={t('dashboard.payrollFund')} value={money(k.payroll_fund)} sub={tr("по ставкам")} tone="violet" icon={<Wallet />} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4"><div className="flex items-center justify-between mb-2"><h2 className="font-medium">{t('dashboard.accrualFund')}</h2><span className="text-xs text-muted">{tr("Итого:")} {money(total)}</span></div>
          <div className="h-44 relative"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={fund} dataKey="value" innerRadius={55} outerRadius={78} paddingAngle={3} stroke="none">{fund.map((_, i) => <Cell key={i} fill={['#2563eb', '#16a34a', '#dc2626', '#d97706'][i]} />)}</Pie><Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} /></PieChart></ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><div className="text-sm font-bold">{money(total)}</div></div></div>
          <div className="space-y-1 text-sm mt-2">{[[tr("Зарплата"), k.total_salary, '#2563eb'], [tr("Бонусы"), k.total_bonuses, '#16a34a'], [tr("Штрафы"), k.total_fines, '#dc2626'], [tr("Выплачено"), k.paid_out, '#d97706']].map(([l, v, c]) => <div key={String(l)} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: String(c) }} /><span className="text-muted flex-1">{l}</span><span className="font-medium tabular-nums">{money(Number(v))}</span></div>)}</div></div>
        <div className="card p-4"><h2 className="font-medium mb-2">{t('dashboard.paymentsDynamics')}</h2>
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={k.payments_series} margin={{ left: -10, right: 4 }}><XAxis dataKey="week" tickFormatter={(d) => fmtDate(d, 'dd.MM')} fontSize={10} stroke="var(--text-subtle)" /><YAxis fontSize={10} stroke="var(--text-subtle)" tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><Tooltip formatter={(v) => money(Number(v))} labelFormatter={(d) => tr("Неделя с {{v0}}", { v0: fmtDate(String(d)) })} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} /><Bar dataKey="amount" fill="var(--accent)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="card p-4"><h2 className="font-medium mb-3">{t('dashboard.quickActions')}</h2>
          <div className="space-y-2">
            {[[t('dashboard.accrueSalary'), 'salary'], [t('dashboard.addBonus'), 'bonus'], [t('dashboard.addFine'), 'fine']].map(([l, k2]) => (
              <button key={String(k2)} className="btn-secondary w-full justify-start" onClick={() => setModal(k2 as 'salary')}>{l}</button>
            ))}
            <button className="btn-secondary w-full justify-start" onClick={() => nav(`/${slug}/payroll`)}>{t('dashboard.report')}</button>
          </div></div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2 overflow-x-auto"><h2 className="font-medium mb-2">{t('dashboard.lastOps')}</h2>
          <table className="table"><thead><tr><th>{tr("Дата")}</th><th>{tr("Сотрудник")}</th><th>{tr("Тип")}</th><th>{tr("Описание")}</th><th className="text-right">{tr("Сумма")}</th></tr></thead><tbody>
            {(tx.data?.items ?? []).map((x: { id: number; created_at: string; employee_name: string; department_name: string | null; type: string; reason: string; signed_amount: string }) => (
              <tr key={x.id}><td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(x.created_at)}</td><td><div className="font-medium">{x.employee_name}</div><div className="text-xs text-muted">{x.department_name ?? ''}</div></td><td><StatusBadge status={{ salary: 'approved', bonus: 'accepted', fine: 'rejected', payment: 'pending' }[x.type] ?? ''} label={{ salary: tr("Начисление"), bonus: tr("Бонус"), fine: tr("Штраф"), payment: tr("Выплата") }[x.type]} /></td><td className="text-xs text-muted max-w-xs truncate">{x.reason || '—'}</td><td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', +x.signed_amount < 0 ? 'text-danger' : 'text-success')}>{signedMoney(x.signed_amount)}</td></tr>
            ))}
          </tbody></table>{!tx.data?.items?.length && <Empty />}</div>
        <div className="space-y-4">
          <div className="card p-4"><h2 className="font-medium mb-2">{t('dashboard.byDep')}</h2>
            {k.employees_by_department.map((d: { name: string; count: number }) => <div key={d.name} className="flex items-center justify-between text-sm py-1"><span className="text-muted">{d.name}</span><span className="font-semibold">{d.count}</span></div>)}</div>
          <div className="card p-4"><h2 className="font-medium mb-2 flex items-center gap-2"><Cake className="h-4 w-4 text-warning" />{t('dashboard.birthdays')}</h2>
            {k.upcoming_birthdays.length ? k.upcoming_birthdays.map((b: { employee_id: number; full_name: string; date: string; days_left: number }) => <div key={b.employee_id} className="flex items-center justify-between text-sm py-1"><span>{b.full_name}</span><span className="text-xs text-muted">{fmtDate(b.date, 'dd.MM')} · {b.days_left === 0 ? tr("сегодня") : tr("через {{v0}} дн.", { v0: b.days_left })}</span></div>) : <Empty text={tr("Нет данных")} />}</div>
        </div>
      </div>
      {modal && <TransactionModal open type={modal} onClose={() => setModal(null)} />}
    </>
  )
}

export { AlertTriangle }
