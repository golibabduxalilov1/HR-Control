import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight, FileEdit, Loader2, Pencil, Play, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/api/client'
import { Confirm, Empty, Field, Kpi, Modal, MoneyInput, Select, Spinner, Tabs, Toggle, useToast } from '@/components/ui'
import { MONTHS, WEEKDAYS, WEEKDAYS_FULL, fmtDate } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { AssignModal } from './Structure'

export type Schedule = { id: number; name: string; code: string; color: string; type: 'fixed' | 'flexible' | 'shift'; status: 'active' | 'draft'; start_time: string | null; end_time: string | null; lunch_enabled: boolean; lunch_start: string | null; lunch_end: string | null; late_grace_min: number; early_grace_min: number; work_days: boolean[]; rest_days_per_month: number; full_day_threshold_min: number | null; hours_calc: 'first_last' | 'sessions'; rounding_min: number; overtime_mode: 'none' | 'full_day' | 'overtime_only'; overtime_tolerance_min: number; weekday_rate_pct: number; weekend_rate_pct: number; overtime_hour_amount: string | null; employee_count: number; day_offs: string[] }
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#dc2626', '#0d9488', '#64748b']
const blank: Omit<Schedule, 'id' | 'employee_count' | 'day_offs'> = { name: '', code: '', color: COLORS[0], type: 'fixed', status: 'active', start_time: '09:00', end_time: '18:00', lunch_enabled: true, lunch_start: '13:00', lunch_end: '14:00', late_grace_min: 10, early_grace_min: 10, work_days: [true, true, true, true, true, false, false], rest_days_per_month: 0, full_day_threshold_min: null, hours_calc: 'first_last', rounding_min: 0, overtime_mode: 'none', overtime_tolerance_min: 0, weekday_rate_pct: 100, weekend_rate_pct: 0, overtime_hour_amount: null }

const t5 = (t: string | null) => t?.slice(0, 5) ?? ''
const durationMin = (s: string | null, e: string | null, lunch?: number) => { if (!s || !e) return 0; const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number); let d = eh * 60 + em - (sh * 60 + sm); if (d <= 0) d += 1440; return d - (lunch ?? 0) }
const hmm = (m: number) => `${Math.floor(m / 60)} ${tr("ч")}${m % 60 ? ` ${m % 60} ${tr("мин")}` : ''}`

export function SchedulesPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const isAdmin = role === 'admin'
  const [selected, setSelected] = useState<number | null>(null)
  const [form, setForm] = useState<null | { id?: number }>(null)
  const [assign, setAssign] = useState<Schedule | null>(null)
  const [del, setDel] = useState<Schedule | null>(null)
  const [tab, setTab] = useState<'info' | 'employees' | 'dayoffs' | 'holidays'>('info')
  const q = useQuery({ queryKey: ['schedules'], queryFn: async () => (await api.get('/schedules')).data as Schedule[] })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/schedules/${id}`), onSuccess: () => { toast.push(tr("График удалён")); setDel(null); setSelected(null); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  useEffect(() => { if (q.data?.length && selected === null) setSelected(q.data[0].id) }, [q.data])
  const s = q.data?.find((x) => x.id === selected)
  const total = q.data?.length ?? 0
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-lg font-semibold">{tr("Графики")}</h1><p className="text-sm text-muted">{tr("Управление графиками работы сотрудников")}</p></div>{isAdmin && <button className="btn-primary" onClick={() => setForm({})}><Plus className="h-4 w-4" />{tr("Добавить график")}</button>}</div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Всего графиков")} icon={<CalendarDays />} value={total} />
        <Kpi label={tr("Назначено сотрудников")} icon={<Users />} value={q.data?.reduce((a, b) => a + b.employee_count, 0) ?? 0} tone="success" />
        <Kpi label={tr("Активных")} icon={<Play />} value={q.data?.filter((x) => x.status === 'active').length ?? 0} tone="info" />
        <Kpi label={tr("Черновиков")} icon={<FileEdit />} value={q.data?.filter((x) => x.status === 'draft').length ?? 0} tone="muted" />
      </div>
      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        <div className="card p-2 space-y-1 self-start">
          <div className="text-[10px] uppercase text-muted px-2 py-1">{tr("Список графиков")}</div>
          {q.isLoading && <Spinner />}
          {(q.data ?? []).map((x) => (
            <button key={x.id} onClick={() => setSelected(x.id)} className={clsx('w-full text-left rounded-xl px-3 py-2.5 transition cursor-pointer', selected === x.id ? 'bg-accent-soft ring-1 ring-accent/30' : 'hover:bg-elevated')}>
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} /><span className="font-medium text-sm flex-1 truncate">{x.name}</span><span className={x.status === 'active' ? 'badge-green' : 'badge-gray'}>{x.status === 'active' ? tr("Активный") : tr("Черновик")}</span></div>
              <div className="text-xs text-muted mt-0.5 pl-4">{x.type === 'flexible' ? tr("По фактическим часам") : tr("{{v0}} – {{v1}} · {{v2}}/7 дн.", { v0: t5(x.start_time), v1: t5(x.end_time), v2: x.work_days.filter(Boolean).length })} · {x.employee_count} {tr("сотр.")}</div>
            </button>
          ))}
          {!q.isLoading && !q.data?.length && <Empty text={tr("Графиков нет")} />}
        </div>
        <div className="space-y-4">
          {s ? <>
            <div className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: s.color }} /><h2 className="text-lg font-bold">{s.name}</h2><span className={s.status === 'active' ? 'badge-green' : 'badge-gray'}>{s.status === 'active' ? tr("Активный") : tr("Черновик")}</span>
                {s.type !== 'flexible' && <span className="text-sm text-muted">· {t5(s.start_time)} – {t5(s.end_time)}</span>}
                {isAdmin && <div className="ml-auto flex gap-1"><button className="btn-secondary btn-sm" onClick={() => setAssign(s)}><Users className="h-3.5 w-3.5" />{tr("Назначить")}</button><button className="btn-secondary btn-sm" onClick={() => setForm({ id: s.id })}><Pencil className="h-3.5 w-3.5" />{tr("Редактировать")}</button><button className="btn-danger btn-sm" onClick={() => setDel(s)}><Trash2 className="h-3.5 w-3.5" />{tr("Удалить")}</button></div>}
              </div>
              <Tabs className="mt-3" value={tab} onChange={setTab} items={[{ value: 'info', label: tr("Общая информация") }, { value: 'employees', label: tr("Сотрудники"), count: s.employee_count }, { value: 'dayoffs', label: tr("Выходные") }, { value: 'holidays', label: tr("Праздники") }]} />
            </div>
            {tab === 'info' && <InfoTab s={s} />}
            {tab === 'employees' && <EmployeesTab s={s} onAssign={() => setAssign(s)} isAdmin={isAdmin} />}
            {tab === 'dayoffs' && <DayOffsTab s={s} isAdmin={isAdmin} />}
            {tab === 'holidays' && <HolidaysTab isAdmin={isAdmin} />}
          </> : <div className="card p-8"><Empty text={tr("Выберите график слева")} /></div>}
        </div>
      </div>
      {form && <ScheduleForm id={form.id} onClose={() => setForm(null)} />}
      {assign && <AssignModal target={{ kind: 'schedule', id: assign.id, name: assign.name }} onClose={() => setAssign(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} title={tr("Удалить график «{{v0}}»?", { v0: del?.name })} text={tr("Сотрудники останутся без графика (по факту).")} danger loading={remove.isPending} />
    </div>
  )
}

function InfoTab({ s }: { s: Schedule }) {
  const lunch = s.lunch_enabled ? durationMin(s.lunch_start, s.lunch_end) : 0
  const dur = durationMin(s.start_time, s.end_time, lunch)
  const days = s.work_days.filter(Boolean).length
  const rows: [string, React.ReactNode][] = [
    [tr("Название"), s.name], [tr("Код"), s.code || '—'], [tr("Тип"), { fixed: tr("Фиксированный"), flexible: tr("Гибкий"), shift: tr("Сменный") }[s.type]], [tr("Статус"), s.status === 'active' ? tr("Активный") : tr("Черновик")],
    [tr("Оплата вне графика"), s.overtime_mode === 'none' ? tr("Нет") : s.overtime_mode === 'full_day' ? tr("Весь день вне графика") : tr("Только переработка")],
    [tr("Округление"), s.rounding_min ? tr("до {{v0}} мин", { v0: s.rounding_min }) : tr("Нет")], [tr("Ставка вне графика"), s.overtime_mode === 'none' ? '—' : s.overtime_hour_amount ? tr("{{v0}} сум/ч", { v0: s.overtime_hour_amount }) : `${s.weekday_rate_pct}%`],
    [tr("Ставка в выходной"), s.weekend_rate_pct ? `${s.weekend_rate_pct}%` : tr("как будни")], [tr("Дней отдыха для оклада"), s.rest_days_per_month], [tr("Полный день по минимуму"), s.full_day_threshold_min ? hmm(s.full_day_threshold_min) : tr("Выкл.")],
    [tr("Подсчёт часов"), s.hours_calc === 'sessions' ? tr("Сессии (сумма)") : tr("Первый вход — первый выход")],
  ]
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Основная информация")}</h3><div className="divide-y divide-line text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between py-1.5 gap-3"><span className="text-muted">{k}</span><span className="font-medium text-right">{v}</span></div>)}</div></div>
      <div className="space-y-4">
        {s.type !== 'flexible' && <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Время работы")}</h3>
          <div className="grid grid-cols-3 gap-2 text-center">{[[tr("Начало"), t5(s.start_time)], [tr("Окончание"), t5(s.end_time)], [tr("Длительность"), hmm(dur)]].map(([k, v]) => <div key={k} className="rounded-xl bg-elevated p-2"><div className="text-[10px] uppercase text-muted">{k}</div><div className="font-bold">{v}</div></div>)}</div>
          <div className="divide-y divide-line text-sm mt-2">{[[tr("Обед"), s.lunch_enabled ? tr("{{v0}}–{{v1}} (не оплачивается)", { v0: t5(s.lunch_start), v1: t5(s.lunch_end) }) : tr("не учитывается")], [tr("Допуск опоздания"), tr("{{v0}} мин", { v0: s.late_grace_min })], [tr("Допуск раннего ухода"), tr("{{v0}} мин", { v0: s.early_grace_min })]].map(([k, v]) => <div key={k} className="flex justify-between py-1.5"><span className="text-muted">{k}</span><span className="font-medium">{v}</span></div>)}</div></div>}
        <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Рабочие дни")}</h3>
          <div className="flex gap-1.5 mb-2">{s.work_days.map((on, i) => <div key={i} className={clsx('flex-1 rounded-lg py-1.5 text-center text-xs font-medium', on ? 'bg-accent text-white' : 'bg-elevated text-muted')}>{WEEKDAYS[i]}</div>)}</div>
          <div className="text-xs text-muted">{days} {tr("дн/нед ·")} {hmm(dur * days)}{tr("/нед")}</div></div>
      </div>
    </div>
  )
}

function EmployeesTab({ s, onAssign, isAdmin }: { s: Schedule; onAssign: () => void; isAdmin: boolean }) {
  const q = useQuery({ queryKey: ['employees-by-schedule', s.id], queryFn: async () => (await api.get('/employees?per_page=500')).data.items as { id: number; full_name: string; position_name: string | null; department_name: string | null; schedule_id: number | null; avatar_url: string | null }[] })
  const items = (q.data ?? []).filter((e) => e.schedule_id === s.id)
  const byDep = items.reduce((acc: Record<string, number>, e) => { acc[e.department_name ?? tr("Без подразделения")] = (acc[e.department_name ?? tr("Без подразделения")] ?? 0) + 1; return acc }, {})
  return (
    <div className="grid md:grid-cols-[1fr_260px] gap-4">
      <div className="card p-4"><div className="flex items-center justify-between mb-2"><h3 className="font-medium text-sm">{tr("Назначенные сотрудники (")}{items.length})</h3>{isAdmin && <button className="btn-secondary btn-sm" onClick={onAssign}>{tr("Назначить сотрудников")}</button>}</div>
        <div className="divide-y divide-line">{items.map((e) => <div key={e.id} className="flex items-center justify-between py-2 text-sm"><span className="font-medium">{e.full_name}</span><span className="text-muted text-xs">{[e.position_name, e.department_name].filter(Boolean).join(' · ') || '—'}</span></div>)}</div>{!items.length && <Empty />}</div>
      <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Назначенные подразделения")}</h3>{Object.entries(byDep).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-1"><span className="text-muted">{k}</span><span className="font-medium">{v} {tr("чел.")}</span></div>)}{!items.length && <Empty />}</div>
    </div>
  )
}

function DayOffsTab({ s, isAdmin }: { s: Schedule; isAdmin: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const holidays = useQuery({ queryKey: ['holidays', year], queryFn: async () => (await api.get('/holidays', { params: { year } })).data as { date: string; name: string }[] })
  const add = useMutation({ mutationFn: async (date: string) => api.post(`/schedules/${s.id}/day-offs`, { date }), onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }), onError: (e) => toast.push(errorMessage(e), 'error') })
  const remove = useMutation({ mutationFn: async (date: string) => api.delete(`/schedules/${s.id}/day-offs/${date}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }) })
  const daysIn = new Date(year, month, 0).getDate()
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const hol = new Map((holidays.data ?? []).map((h) => [h.date, h.name]))
  const offs = new Set(s.day_offs)
  let work = 0, rest = 0
  const cells = Array.from({ length: daysIn }, (_, i) => {
    const d = new Date(year, month - 1, i + 1)
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const wd = (d.getDay() + 6) % 7
    const isWork = s.type !== 'flexible' && s.work_days[wd] && !offs.has(iso) && !hol.has(iso)
    isWork ? work++ : rest++
    return { iso, day: i + 1, isWork, isOff: offs.has(iso), holiday: hol.get(iso), byWeek: !s.work_days[wd] }
  })
  const prev = () => { if (month === 1) { setMonth(12); setYear(year - 1) } else setMonth(month - 1) }
  const next = () => { if (month === 12) { setMonth(1); setYear(year + 1) } else setMonth(month + 1) }
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="text-xs text-muted">{tr("Нажмите на синий рабочий день в календаре — выходной только для этого графика.")} <b>{work} {tr("раб. /")} {rest} {tr("вых.")}</b></div>
        <div className="flex items-center gap-1"><button className="btn-ghost btn-sm" onClick={prev}><ChevronLeft className="h-4 w-4" /></button><span className="text-sm font-semibold min-w-32 text-center">{MONTHS[month - 1]} {year}</span><button className="btn-ghost btn-sm" onClick={next}><ChevronRight className="h-4 w-4" /></button></div>
      </div>
      <div className="flex gap-3 text-xs text-muted mb-2">{[['bg-accent', tr("Рабочий")], ['bg-warning', tr("Доп. выходной")], ['bg-elevated border border-line', tr("Выходной по графику")], ['bg-danger/60', tr("Праздник")]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={clsx('h-2.5 w-2.5 rounded', c)} />{l}</span>)}</div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase text-muted text-center mb-1">{WEEKDAYS_FULL.map((w) => <div key={w} className="truncate">{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }).map((_, i) => <div key={`o${i}`} />)}
        {cells.map((c) => (
          <button key={c.iso} type="button" disabled={!isAdmin || s.type === 'flexible'} onClick={() => (c.isOff ? remove.mutate(c.iso) : add.mutate(c.iso))}
            className={clsx('rounded-xl p-2 min-h-14 text-left transition disabled:cursor-default', c.holiday ? 'bg-danger/10 border border-danger/30' : c.isOff ? 'bg-warning/15 border border-warning/40' : c.isWork ? 'bg-accent-soft border border-accent/20 hover:bg-accent/20' : 'bg-elevated border border-line')}>
            <div className="text-sm font-bold">{c.day}</div><div className="text-[10px] text-muted truncate">{c.holiday ?? (c.isWork ? `${t5(s.start_time)}–${t5(s.end_time)}` : c.isOff ? tr("Доп. выходной") : tr("Выходной"))}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function HolidaysTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [year, setYear] = useState(new Date().getFullYear())
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [bulk, setBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const q = useQuery({ queryKey: ['holidays', year], queryFn: async () => (await api.get('/holidays', { params: { year } })).data as { id: number; date: string; name: string }[] })
  const inv = () => qc.invalidateQueries({ queryKey: ['holidays'] })
  const add = useMutation({ mutationFn: async () => api.post('/holidays', { date, name }), onSuccess: () => { setDate(''); setName(''); inv() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const addUz = useMutation({ mutationFn: async () => api.post(`/holidays/uzbekistan/${year}`), onSuccess: () => { toast.push(tr("Праздники Узбекистана добавлены")); inv() } })
  const addBulk = useMutation({ mutationFn: async () => api.post('/holidays/bulk', bulkText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [d, ...n] = l.split(/[\s;,]+/); const [dd, mm, yy] = d.split('.'); return { date: yy ? `${yy}-${mm}-${dd}` : d, name: n.join(' ') || tr("Праздник") } })), onSuccess: () => { toast.push(tr("Импортировано")); setBulk(false); setBulkText(''); inv() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/holidays/${id}`), onSuccess: inv })
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><h3 className="font-medium text-sm">{tr("Праздничные и нерабочие дни")}</h3><div className="text-xs text-muted">{tr("Общие для всей компании. Учитываются в табеле и календаре графиков.")}</div></div>
        <div className="flex items-center gap-2"><Select className="w-28" value={year} onChange={setYear} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }))} />{isAdmin && <><button className="btn-secondary btn-sm" onClick={() => addUz.mutate()}>{tr("Добавить праздники Узбекистана")}</button><button className="btn-secondary btn-sm" onClick={() => setBulk(true)}>{tr("Импорт списком")}</button></>}</div></div>
      {isAdmin && <div className="flex flex-wrap gap-2 mb-3"><input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} /><input className="input flex-1 min-w-40" placeholder={tr("Название")} value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary" disabled={!date || !name} onClick={() => add.mutate()}>{tr("Добавить")}</button></div>}
      <div className="divide-y divide-line">{(q.data ?? []).map((h) => <div key={h.id} className="flex items-center justify-between py-2 text-sm"><span className="font-medium">{h.name}</span><span className="flex items-center gap-2 text-muted">{fmtDate(h.date)}{isAdmin && <button className="btn-ghost btn-sm text-danger" onClick={() => remove.mutate(h.id)}><Trash2 className="h-3.5 w-3.5" /></button>}</span></div>)}</div>
      {!q.data?.length && <Empty text={tr("Праздников нет")} />}
      <Modal open={bulk} onClose={() => setBulk(false)} title={tr("Импорт праздников списком")} size="sm" footer={<><button className="btn-secondary" onClick={() => setBulk(false)}>{tr("Отмена")}</button><button className="btn-primary" onClick={() => addBulk.mutate()}>{tr("Импорт")}</button></>}>
        <textarea className="input font-mono text-xs" rows={8} placeholder={tr("01.01.2026 Новый год") + "\n" + tr("08.03.2026 Женский день")} value={bulkText} onChange={(e) => setBulkText(e.target.value)} /></Modal>
    </div>
  )
}

function ScheduleForm({ id, onClose }: { id?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const existing = useQuery({ queryKey: ['schedules'], queryFn: async () => (await api.get('/schedules')).data as Schedule[] })
  const [f, setF] = useState({ ...blank })
  const [overtime, setOvertime] = useState(false)
  const [rateMode, setRateMode] = useState<'pct' | 'amount'>('pct')
  useEffect(() => { const s = existing.data?.find((x) => x.id === id); if (s) { setF({ ...s, start_time: t5(s.start_time), end_time: t5(s.end_time), lunch_start: t5(s.lunch_start), lunch_end: t5(s.lunch_end) }); setOvertime(s.overtime_mode !== 'none'); setRateMode(s.overtime_hour_amount ? 'amount' : 'pct') } }, [existing.data, id])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const m = useMutation({
    mutationFn: async () => { const body = { ...f, overtime_mode: overtime ? f.overtime_mode === 'none' ? 'overtime_only' : f.overtime_mode : 'none', overtime_hour_amount: rateMode === 'amount' ? f.overtime_hour_amount : null, start_time: f.type === 'flexible' ? null : f.start_time || null, end_time: f.type === 'flexible' ? null : f.end_time || null, lunch_start: f.lunch_enabled ? f.lunch_start || null : null, lunch_end: f.lunch_enabled ? f.lunch_end || null : null }; return id ? api.put(`/schedules/${id}`, body) : api.post('/schedules', body) },
    onSuccess: () => { toast.push(id ? tr("График обновлён") : tr("График создан")); qc.invalidateQueries(); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error'),
  })
  const lunch = f.lunch_enabled ? durationMin(f.lunch_start, f.lunch_end) : 0
  const dur = durationMin(f.start_time, f.end_time, lunch)
  const days = f.work_days.filter(Boolean).length
  const now = new Date()
  const monthDays = Array.from({ length: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() }, (_, i) => (new Date(now.getFullYear(), now.getMonth(), i + 1).getDay() + 6) % 7).filter((wd) => f.work_days[wd]).length
  const Step = ({ n, title, sub }: { n: number; title: string; sub: string }) => <div className="flex items-center gap-2 mb-2"><span className="h-6 w-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">{n}</span><div><div className="font-semibold text-sm">{title}</div><div className="text-xs text-muted">{sub}</div></div></div>
  return (
    <Modal open onClose={onClose} title={id ? tr("Редактировать график") : tr("Создать новый график")} subtitle={tr("Настройте режим работы и рабочие дни")} size="lg"
      footer={<><span className="text-xs text-muted mr-auto self-center">{!f.name && tr("Введите название, чтобы сохранить")}</span><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!f.name.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{id ? tr("Сохранить") : tr("Создать график")}</button></>}>
      <div className="space-y-5">
        <div><Step n={1} title={tr("Основное")} sub={tr("Название и цвет в календаре")} />
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end"><Field label={tr("Название графика")}><input className="input" placeholder={tr("Например: Офис 09:00–18:00")} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label={tr("Цвет")}><div className="flex gap-1.5">{COLORS.map((c) => <button key={c} type="button" className={clsx('h-7 w-7 rounded-full transition', f.color === c && 'ring-2 ring-offset-2 ring-accent')} style={{ background: c }} onClick={() => set('color', c)} />)}</div></Field>
            <Field label={tr("Статус")}><Select value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'active', label: tr("Активный") }, { value: 'draft', label: tr("Черновик") }]} /></Field></div></div>
        <div><Step n={2} title={tr("Тип графика")} sub={tr("Как считать посещаемость и часы")} />
          <div className="grid sm:grid-cols-3 gap-2">{([['fixed', tr("Фиксированный"), tr("Начало и конец смены, контроль опозданий и раннего ухода")], ['flexible', tr("Гибкий"), tr("Без фиксированного прихода — учёт только по фактическим часам")], ['shift', tr("Сменный"), tr("Длинная или ночная смена с фиксированным окном")]] as const).map(([v, l, s]) => <button key={v} type="button" onClick={() => set('type', v)} className={clsx('rounded-xl border p-3 text-left transition cursor-pointer', f.type === v ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/40')}><div className="font-medium text-sm">{l}</div><div className="text-xs text-muted mt-0.5">{s}</div></button>)}</div></div>
        {f.type !== 'flexible' && <div><Step n={3} title={tr("Время смены")} sub={tr("Рабочее окно, обед и допуски")} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={tr("Начало")}><input type="time" className="input" value={f.start_time ?? ''} onChange={(e) => set('start_time', e.target.value)} /></Field>
            <Field label={tr("Окончание")} hint={dur ? tr("Длительность {{v0}}", { v0: hmm(dur) }) + (lunch ? tr(" (обед {{v0}} мин не оплачивается)", { v0: lunch }) : '') : undefined}><input type="time" className="input" value={f.end_time ?? ''} onChange={(e) => set('end_time', e.target.value)} /></Field>
            <div className="sm:col-span-2 rounded-xl border border-line p-3"><Toggle checked={f.lunch_enabled} onChange={(v) => set('lunch_enabled', v)} label={tr("Обеденный перерыв")} hint={tr("Время обеда вычитается из отработанных часов")} />
              {f.lunch_enabled && <div className="grid grid-cols-2 gap-3 mt-2"><Field label={tr("С")}><input type="time" className="input" value={f.lunch_start ?? ''} onChange={(e) => set('lunch_start', e.target.value)} /></Field><Field label={tr("До")}><input type="time" className="input" value={f.lunch_end ?? ''} onChange={(e) => set('lunch_end', e.target.value)} /></Field></div>}</div>
            <Field label={tr("Допуск опоздания (мин)")} hint={tr("Например: {{v0}} мин — приход в {{v1}} всё ещё считается вовремя", { v0: f.late_grace_min, v1: f.start_time ? addMin(f.start_time, f.late_grace_min) : '…' })}><input type="number" className="input" min={0} value={f.late_grace_min} onChange={(e) => set('late_grace_min', +e.target.value)} /></Field>
            <Field label={tr("Допуск раннего ухода (мин)")}><input type="number" className="input" min={0} value={f.early_grace_min} onChange={(e) => set('early_grace_min', +e.target.value)} /></Field>
            <Field label={tr("Дней отдыха в месяц (для оклада)")} hint={tr("Конкретные даты не задаются — сотрудник сам выбирает дни. Уменьшает только норму оклада. {{v0}}: по графику {{v1}} дн. → ставка {{v2}} дн.", { v0: MONTHS[now.getMonth()], v1: monthDays, v2: Math.max(monthDays - f.rest_days_per_month, 0) })}><input type="number" className="input" min={0} value={f.rest_days_per_month} onChange={(e) => set('rest_days_per_month', +e.target.value)} /></Field>
            <div className="rounded-xl border border-line p-3"><Toggle checked={f.full_day_threshold_min !== null} onChange={(v) => set('full_day_threshold_min', v ? Math.round(dur * 0.75) : null)} label={tr("Полный день по минимуму")} hint={tr("Если сотрудник отработал не меньше порога — день считается полным для оклада")} />
              {f.full_day_threshold_min !== null && <div className="mt-2 flex items-center gap-2 text-sm">{tr("Порог:")} <input type="number" className="input !w-24" min={0} value={f.full_day_threshold_min} onChange={(e) => set('full_day_threshold_min', +e.target.value)} /> {tr("мин")}</div>}</div>
          </div></div>}
        <div><Step n={f.type === 'flexible' ? 3 : 4} title={tr("Рабочие дни")} sub={tr("Нажмите, чтобы включить или выключить день")} />
          <div className="grid grid-cols-7 gap-1.5">{WEEKDAYS_FULL.map((d, i) => <button key={d} type="button" onClick={() => set('work_days', f.work_days.map((x, j) => (j === i ? !x : x)))} className={clsx('rounded-xl py-2 text-center text-xs font-medium transition', f.work_days[i] ? 'bg-accent text-white' : 'bg-elevated text-muted')}>{WEEKDAYS[i]}</button>)}</div>
          <div className="text-xs text-muted mt-1">{days} {tr("дн/нед ·")} {hmm(dur * days)}{tr("/нед")}</div></div>
        <div className="rounded-xl border border-line p-3 space-y-3">
          <Toggle checked={overtime} onChange={setOvertime} label={tr("Оплата вне графика")} hint={tr("Доплата за переработки и работу вне смены")} />
          {overtime && <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={tr("Округлять отработанные часы")}><Select value={f.rounding_min} onChange={(v) => set('rounding_min', v)} options={[{ value: 0, label: tr("Нет") }, { value: 5, label: tr("До 5 мин") }, { value: 15, label: tr("До 15 мин") }, { value: 30, label: tr("До 30 мин") }, { value: 60, label: tr("До часа") }]} /></Field>
              <Field label={tr("Допуск до/после смены ({{v0}}–{{v1}})", { v0: f.start_time, v1: f.end_time })} hint={tr("Минуты вокруг смены, которые не считаются переработкой")}><input type="number" className="input" min={0} value={f.overtime_tolerance_min} onChange={(e) => set('overtime_tolerance_min', +e.target.value)} /></Field>
            </div>
            <Field label={tr("Ставка вне графика")}><div className="grid sm:grid-cols-2 gap-2">{([['full_day', tr("Весь день вне графика"), tr("Выходные целиком по повышенной ставке")], ['overtime_only', tr("Только переработка"), tr("До {{v0}} и после {{v1}}", { v0: f.start_time, v1: f.end_time })]] as const).map(([v, l, s]) => <button key={v} type="button" onClick={() => set('overtime_mode', v)} className={clsx('rounded-xl border p-3 text-left cursor-pointer', (f.overtime_mode === v || (f.overtime_mode === 'none' && v === 'overtime_only')) ? 'border-accent bg-accent-soft' : 'border-line')}><div className="font-medium text-sm">{l}</div><div className="text-xs text-muted">{s}</div></button>)}</div></Field>
            <Tabs value={rateMode} onChange={setRateMode} items={[{ value: 'pct', label: tr("Процент") }, { value: 'amount', label: tr("Сумма за час") }]} />
            {rateMode === 'pct' ? <div className="grid sm:grid-cols-2 gap-3">
              <Field label={tr("Будни / переработка")} hint={tr("Обычные рабочие дни — например 100%")}><div className="flex gap-1">{[100, 125, 150, 200].map((p) => <button key={p} type="button" className={clsx('btn-secondary btn-sm', f.weekday_rate_pct === p && '!bg-accent !text-white')} onClick={() => set('weekday_rate_pct', p)}>{p}%</button>)}</div></Field>
              <Field label={tr("Выходной / воскресенье")} hint={tr("Дни вне рабочих дней графика. 0 — как будни.")}><div className="flex gap-1">{[0, 100, 150, 200].map((p) => <button key={p} type="button" className={clsx('btn-secondary btn-sm', f.weekend_rate_pct === p && '!bg-accent !text-white')} onClick={() => set('weekend_rate_pct', p)}>{p ? `${p}%` : tr("как будни")}</button>)}</div></Field></div>
              : <Field label={tr("Сумма за час вне графика")}><MoneyInput value={f.overtime_hour_amount ?? ''} onChange={(v) => set('overtime_hour_amount', v)} /></Field>}
          </>}
        </div>
        <Field label={tr("Подсчёт часов за день")}><div className="grid sm:grid-cols-2 gap-2">{([['first_last', tr("Первый вход — последний выход"), tr("16:02–16:05 = 3 мин")], ['sessions', tr("Сессии (сумма)"), tr("09–11 + 17–20 = 5 ч")]] as const).map(([v, l, s]) => <button key={v} type="button" onClick={() => set('hours_calc', v)} className={clsx('rounded-xl border p-3 text-left cursor-pointer', f.hours_calc === v ? 'border-accent bg-accent-soft' : 'border-line')}><div className="font-medium text-sm">{l}</div><div className="text-xs text-muted">{s}</div></button>)}</div></Field>
      </div>
    </Modal>
  )
}

function addMin(t: string, m: number) { const [h, mm] = t.split(':').map(Number); const total = h * 60 + mm + m; return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` }
