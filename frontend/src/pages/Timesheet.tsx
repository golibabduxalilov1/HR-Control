import { useQuery } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { AlarmClock, AlertTriangle, ArrowUpDown, CalendarDays, Clock, Download, LogOut, Printer, Search, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api/client'
import { Avatar, Empty, Kpi, Select, Spinner, StatusBadge, Tabs } from '@/components/ui'
import { fmtDate, fmtDateTime, fmtTime, hm, hmHuman, pct } from '@/lib/format'
import { EmployeeDrawer } from './EmployeeDrawer'
import { PeriodBar, usePeriod } from './Payroll'

type Day = { date: string; status: string; check_in: string | null; check_out: string | null; worked_minutes: number; scheduled_minutes: number; late_minutes: number; early_leave_minutes: number; is_manual: boolean; holiday_name: string | null; events: { id: number; event_time: string; direction: string; device_label: string; employee_id: number }[] }
type Item = { employee: { id: number; full_name: string; employee_number: string; avatar_url: string | null; department_name: string | null; position_name: string | null; schedule_mode: string; schedule_label: string | null }; summary: Record<string, number | null>; days: Day[] }

const cellColor: Record<string, string> = { on_time: 'bg-success/15 text-success', worked_off: 'bg-success/10 text-success', late: 'bg-warning/15 text-warning', early_leave: 'bg-warning/15 text-warning', late_early: 'bg-warning/20 text-warning', absent: 'bg-danger/15 text-danger', excused: 'bg-info/15 text-info', remote: 'bg-info/15 text-info', day_off: 'bg-elevated text-subtle', holiday: 'bg-elevated text-subtle', planned: 'text-subtle', leave: 'bg-elevated text-subtle', dismissed: 'bg-elevated text-subtle', not_hired: 'text-subtle' }

export function TimesheetPage() {
  const { t } = useTranslation()
  const period = usePeriod()
  const [q, setQ] = useState('')
  const [dep, setDep] = useState<number | null>(null)
  const [view, setView] = useState<'detail' | 'summary' | 'log'>('summary')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [open, setOpen] = useState<number | null>(null)
  const deps = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as { id: number; name: string }[] })
  const data = useQuery({ queryKey: ['timesheet-summary', period.range, dep], queryFn: async () => (await api.get('/timesheet/summary', { params: { ...period.range, department_id: dep ?? undefined } })).data as { totals: Record<string, number>; items: Item[]; event_count: number } })
  const items = useMemo(() => {
    const list = (data.data?.items ?? []).filter((x) => !q || x.employee.full_name.toLowerCase().includes(q.toLowerCase()))
    const val = (x: Item) => sort.key === 'name' ? x.employee.full_name : Number(x.summary[sort.key] ?? 0)
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : -1) * sort.dir)
  }, [data.data, q, sort])
  const days = data.data?.items[0]?.days ?? []
  const tot = data.data?.totals
  const norm = tot?.scheduled_minutes ?? 0
  const worked = tot?.worked_minutes ?? 0
  const toggleSort = (key: string) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))
  const exportCsv = () => {
    const rows = [[tr("Сотрудник"), tr("Подразделение"), tr("Дней"), tr("Часов"), tr("Норма"), tr("Вовремя"), tr("Опозд."), tr("Ран."), tr("Прог."), ...days.map((d) => d.date.slice(5))], ...items.map((x) => [x.employee.full_name, x.employee.department_name ?? '', x.summary.worked_days, hm(Number(x.summary.worked_minutes)), hm(Number(x.summary.scheduled_minutes)), x.summary.on_time, x.summary.late, x.summary.early_leave, x.summary.absent, ...x.days.map((d) => d.check_in ? `${fmtTime(d.check_in)}${d.check_out ? '-' + fmtTime(d.check_out) : ''}` : t(`status.${d.status}`))])]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(';')).join('\n')], { type: 'text/csv' })); a.download = `timesheet-${period.range.date_from}.csv`; a.click()
  }
  const SortTh = ({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) => <th className={clsx('cursor-pointer select-none', className)} onClick={() => toggleSort(k)}><span className="inline-flex items-center gap-1">{children}<ArrowUpDown className={clsx('h-3 w-3', sort.key === k ? 'text-accent' : 'text-subtle')} /></span></th>
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">{tr("Табель")}</h1><p className="text-sm text-muted">{period.label}</p></div>
        <div className="flex gap-2"><button className="btn-secondary" onClick={exportCsv}><Download className="h-4 w-4" />Excel / CSV</button><button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />{tr("Печать")}</button></div>
      </div>
      <PeriodBar p={period} />
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9" placeholder={tr("Поиск сотрудника...")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="w-52" value={dep} onChange={setDep} options={[{ value: null, label: tr("Все подразделения") }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Kpi label={tr("Норма периода")} icon={<CalendarDays />} value={hmHuman(norm)} sub={tr("{{v0}} сотр. · выполнено {{v1}}%", { v0: tot?.employees ?? 0, v1: norm ? Math.round((worked / norm) * 100) : 0 })} />
        <Kpi label={tr("Всего отработано")} tone="success" icon={<Clock />} value={hmHuman(worked)} sub={norm ? tr("{{v0}}% от нормы", { v0: Math.round((worked / norm) * 100) }) : ''} />
        <Kpi label={tr("Опозданий")} tone="warning" icon={<AlarmClock />} value={tot?.late ?? 0} sub={tr("у {{v0}} из {{v1}} сотр.", { v0: items.filter((x) => Number(x.summary.late) > 0).length, v1: items.length })} />
        <Kpi label={tr("Ран. уход")} tone="info" icon={<LogOut />} value={tot?.early_leave ?? 0} />
        <Kpi label={tr("Пропусков")} tone="danger" icon={<UserX />} value={tot?.absent ?? 0} sub={tr("у {{v0}} сотр.", { v0: items.filter((x) => Number(x.summary.absent) > 0).length })} />
      </div>
      <Tabs value={view} onChange={setView} items={[{ value: 'summary', label: tr("Сводка по сотрудникам"), count: items.length }, { value: 'detail', label: tr("Детальный табель") }, { value: 'log', label: tr("Журнал событий"), count: data.data?.event_count }]} />
      {data.isLoading ? <Spinner /> : view === 'summary' ? (
        <div className="card overflow-x-auto"><table className="table"><thead><tr><SortTh k="name">{tr("Сотрудник")}</SortTh><SortTh k="worked_days" className="text-center">{tr("Дней")}</SortTh><SortTh k="worked_minutes" className="text-center">{tr("Часов")}</SortTh><SortTh k="on_time" className="text-center">{tr("Вовремя")}</SortTh><SortTh k="late" className="text-center">{tr("Опозд.")}</SortTh><SortTh k="early_leave" className="text-center">{tr("Ран.")}</SortTh><SortTh k="absent" className="text-center">{tr("Прог.")}</SortTh><th>{tr("Статус")}</th></tr></thead><tbody>
          {items.map((x) => { const s = x.summary; const flexible = !s.scheduled_minutes; const comp = s.completion_pct; const problem = Number(s.late) + Number(s.absent) * 2 >= 5
            return <tr key={x.employee.id} className="cursor-pointer" onClick={() => setOpen(x.employee.id)}>
              <td><div className="flex items-center gap-2"><Avatar name={x.employee.full_name} src={x.employee.avatar_url} size={34} /><div><div className="font-medium">{x.employee.full_name}</div><div className="text-xs text-muted">№ {x.employee.employee_number}{x.employee.department_name && ` · ${x.employee.department_name}`}</div></div></div></td>
              <td className="text-center tabular-nums">{flexible ? tr("{{v0}} дн.", { v0: s.worked_days }) : `${s.worked_days} / ${s.scheduled_days}`}</td><td className="text-center tabular-nums">{hm(Number(s.worked_minutes))}</td><td className="text-center text-success">{s.on_time}</td><td className={clsx('text-center', Number(s.late) > 0 && 'text-warning font-semibold')}>{s.late}</td><td className={clsx('text-center', Number(s.early_leave) > 0 && 'text-warning font-semibold')}>{s.early_leave}</td><td className={clsx('text-center', Number(s.absent) > 0 && 'text-danger font-semibold')}>{s.absent}</td>
              <td>{flexible ? <span className="badge-gray">{x.employee.schedule_mode === 'flexible' ? tr("Гибкий") : tr("По часам")}<span className="text-subtle">{tr("· по факту")}</span></span> : problem ? <span className="badge-red">{tr("Проблемный ·")} {pct(comp)}</span> : <span className="badge-green">{tr("Норма ·")} {pct(comp)}</span>}</td></tr> })}
        </tbody></table>{!items.length && <Empty />}</div>
      ) : view === 'detail' ? (
        <div className="card overflow-x-auto print:overflow-visible">
          <div className="flex flex-wrap gap-3 text-[10px] text-muted p-3">{[['bg-success', tr("Норм")], ['bg-warning', tr("Опоздание / рано ушёл")], ['bg-danger', tr("Не пришёл")], ['bg-info', tr("Уваж. причина / удалённо")], ['bg-subtle', tr("Выходной / праздник")]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={clsx('h-2 w-2 rounded', c)} />{l}</span>)}</div>
          <table className="table text-xs"><thead><tr><th className="sticky left-0 bg-elevated z-10 min-w-48">{tr("Сотрудник")}</th>{days.map((d) => <th key={d.date} className={clsx('text-center !px-1', d.holiday_name && 'text-danger')} title={d.holiday_name ?? ''}>{d.date.slice(8)}<div className="text-[9px] font-normal">{[tr("пн"), tr("вт"), tr("ср"), tr("чт"), tr("пт"), tr("сб"), tr("вс")][(new Date(d.date).getDay() + 6) % 7]}</div></th>)}<th className="text-right">{tr("Итого")}</th></tr></thead><tbody>
            {items.map((x) => <tr key={x.employee.id} className="cursor-pointer" onClick={() => setOpen(x.employee.id)}>
              <td className="sticky left-0 bg-card z-10"><div className="font-medium truncate max-w-48">{x.employee.full_name}</div><div className="text-[10px] text-muted">{x.employee.department_name ?? '—'}</div></td>
              {x.days.map((d) => <td key={d.date} className="!px-0.5 !py-1"><div className={clsx('rounded-md px-1 py-1 text-center leading-tight min-w-11', cellColor[d.status])} title={`${fmtDate(d.date)} · ${t(`status.${d.status}`)}${d.late_minutes ? tr(" · опозд. {{v0}} мин", { v0: d.late_minutes }) : ''}`}>
                {d.check_in ? <><div className="font-medium">{fmtTime(d.check_in)}</div><div className="text-[9px]">{d.check_out ? fmtTime(d.check_out) : '—'}</div></> : <div className="text-[9px] py-1">{d.holiday_name ? tr("Пр") : d.status === 'absent' ? tr("Н") : d.status === 'day_off' ? tr("В") : d.status === 'excused' ? tr("УП") : d.status === 'planned' ? '' : '·'}</div>}
                {d.is_manual && <div className="h-1 w-1 rounded-full bg-accent mx-auto" />}</div></td>)}
              <td className="text-right font-semibold tabular-nums whitespace-nowrap">{hm(Number(x.summary.worked_minutes))}<div className="text-[10px] text-muted font-normal">{tr("из")} {hm(Number(x.summary.scheduled_minutes))}</div></td></tr>)}
          </tbody></table>{!items.length && <Empty />}</div>
      ) : <EventLog items={items} onOpen={setOpen} />}
      {open && <EmployeeDrawer employeeId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function EventLog({ items, onOpen }: { items: Item[]; onOpen: (id: number) => void }) {
  const { t } = useTranslation()
  const rows = items.flatMap((x) => x.days.flatMap((d) => d.events.map((e) => ({ ...e, emp: x.employee, status: d.status })))).sort((a, b) => b.event_time.localeCompare(a.event_time))
  return (
    <div className="card overflow-x-auto"><table className="table"><thead><tr><th>{tr("Дата и время")}</th><th>{tr("Сотрудник")}</th><th>{tr("Событие")}</th><th>{tr("Устройство")}</th><th>{tr("Статус дня")}</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} className="cursor-pointer" onClick={() => onOpen(r.emp.id)}><td className="tabular-nums whitespace-nowrap">{fmtDateTime(r.event_time)}</td><td><div className="font-medium">{r.emp.full_name}</div><div className="text-xs text-muted">{r.emp.position_name ?? ''}</div></td><td><span className={r.direction === 'in' ? 'badge-green' : 'badge-red'}>{r.direction === 'in' ? tr("Приход") : tr("Уход")}</span></td><td className="text-xs text-muted">{r.device_label}</td><td><StatusBadge status={r.status} label={t(`status.${r.status}`)} /></td></tr>)}
    </tbody></table>{!rows.length && <Empty />}</div>
  )
}
