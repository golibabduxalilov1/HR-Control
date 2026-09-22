import { useQuery } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { AlertTriangle, Clock, Download, Search, UserCheck, UserX, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { api } from '@/api/client'
import { Avatar, Empty, Kpi, Select, Spinner } from '@/components/ui'
import { fmtDate, fmtTime, hmHuman, todayISO } from '@/lib/format'
import { EmployeeDrawer } from './EmployeeDrawer'

type Item = { employee_id: number; full_name: string; position: string; department_name: string | null; avatar_url: string | null; check_in_time: string | null; check_out_time: string | null; worked_minutes: number; late_minutes: number; early_leave_minutes: number; problem_reason: string | null; status: string }

export function TodayPage() {
  const { t } = useTranslation()
  const [date, setDate] = useState(todayISO())
  const [q, setQ] = useState('')
  const [dep, setDep] = useState<number | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [byDep, setByDep] = useState(false)
  const [status, setStatus] = useState<'all' | 'present' | 'late' | 'absent'>('all')
  const pick = (v: 'present' | 'late' | 'absent') => setStatus((c) => (c === v ? 'all' : v))
  const show = (v: 'present' | 'late' | 'absent') => status === 'all' || status === v
  const deps = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as { id: number; name: string }[] })
  const data = useQuery({ queryKey: ['today', date, dep], queryFn: async () => (await api.get('/attendance/today', { params: { date, department_id: dep ?? undefined } })).data, refetchInterval: 60_000 })
  const logs = useQuery({ queryKey: ['day-logs', date], queryFn: async () => (await api.get('/attendance/day-logs', { params: { date } })).data, refetchInterval: 60_000 })
  if (data.isLoading || !data.data) return <Spinner />
  const d = data.data
  const f = (arr: Item[]) => arr.filter((x) => !q || x.full_name.toLowerCase().includes(q.toLowerCase()))
  const problems = [...d.late_list, ...d.absent_list]
  const pie = [{ v: d.on_site_now, c: '#16a34a' }, { v: d.left_today, c: '#94a3b8' }, { v: d.absent, c: '#dc2626' }].filter((x) => x.v)
  const exportCsv = () => {
    const rows = [[tr("Сотрудник"), tr("Подразделение"), tr("Статус"), tr("Пришёл"), tr("Ушёл"), tr("Часы")], ...[...d.present_list, ...d.late_list, ...d.remote_list, ...d.absent_list].map((x: Item) => [x.full_name, x.department_name ?? '', t(`status.${x.status}`), x.check_in_time ?? '', x.check_out_time ?? '', hmHuman(x.worked_minutes)])]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.join(';')).join('\n')], { type: 'text/csv' })); a.download = `today-${date}.csv`; a.click()
  }
  const Row = ({ x, extra }: { x: Item; extra?: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:bg-accent-soft/50 rounded-lg px-1 -mx-1" onClick={() => setOpen(x.employee_id)}>
      <Avatar name={x.full_name} src={x.avatar_url} size={34} /><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{x.full_name}</div><div className="text-xs text-muted truncate">{[x.position, x.department_name].filter(Boolean).join(' · ') || '—'}</div></div>{extra}
    </div>
  )
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">{tr("Сегодняшняя информация")}</h1><p className="text-sm text-muted">{tr("Посещаемость сотрудников на")} {fmtDate(date)}</p></div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9 w-56" placeholder={tr("Поиск сотрудника...")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select className="w-48" value={dep} onChange={setDep} options={[{ value: null, label: tr("Все подразделения") }, ...(deps.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
          <button className="btn-secondary" onClick={exportCsv}><Download className="h-4 w-4" />{tr("Экспорт")}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Всего сотрудников")} value={d.total} sub="100%" icon={<Users />} onClick={() => setStatus('all')} active={status === 'all'} />
        <Kpi label={tr("Присутствуют")} tone="success" icon={<UserCheck />} onClick={() => pick('present')} active={status === 'present'} value={d.present + d.remote} sub={`${d.attendance_total ? Math.round(((d.present + d.remote) / d.attendance_total) * 1000) / 10 : 0}%`} />
        <Kpi label={tr("Опоздали")} icon={<Clock />} onClick={() => pick('late')} active={status === 'late'} value={d.late} sub={`${d.attendance_total ? Math.round((d.late / d.attendance_total) * 1000) / 10 : 0}%`} tone="warning" />
        <Kpi label={tr("Отсутствуют")} icon={<UserX />} onClick={() => pick('absent')} active={status === 'absent'} value={d.absent} sub={`${d.attendance_total ? Math.round((d.absent / d.attendance_total) * 1000) / 10 : 0}%`} tone="danger" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        {show('present') && <div className={clsx('card p-4', status !== 'all' && 'lg:col-span-3')}><h3 className="font-medium text-sm mb-2 flex items-center gap-2">{tr("Кто вовремя пришёл (")}{f(d.present_list).length + f(d.remote_list).length})</h3>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] uppercase text-muted mb-1"><span>{tr("Сотрудник")}</span><span>{tr("Пришёл")}</span><span>{tr("Ушёл")}</span><span>{tr("Часы")}</span></div>
          {[...f(d.present_list), ...f(d.remote_list)].map((x: Item) => <Row key={x.employee_id} x={x} extra={<div className="grid grid-cols-3 gap-3 text-xs tabular-nums text-right"><span className="text-success font-medium">{x.check_in_time ?? '—'}</span><span>{x.check_out_time ?? '—'}</span><span className="text-muted">{x.worked_minutes ? hmHuman(x.worked_minutes) : '—'}</span></div>} />)}
          {!f(d.present_list).length && !f(d.remote_list).length && <Empty text="—" />}</div>}
        {show('late') && <div className={clsx('card p-4', status !== 'all' && 'lg:col-span-3')}><h3 className="font-medium text-sm mb-2 flex items-center gap-2">{tr("Кто опоздал / рано ушёл (")}{f(d.late_list).length})</h3>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] uppercase text-muted mb-1"><span>{tr("Сотрудник")}</span><span>{tr("Пришёл")}</span><span>{tr("Опозд.")}</span><span>{tr("Ран. уход")}</span></div>
          {f(d.late_list).map((x: Item) => <Row key={x.employee_id} x={x} extra={<div className="grid grid-cols-3 gap-3 text-xs tabular-nums text-right"><span className="font-medium">{x.check_in_time ?? '—'}</span><span className="text-warning">{x.late_minutes ? hmHuman(x.late_minutes) : '—'}</span><span className="text-warning">{x.early_leave_minutes ? hmHuman(x.early_leave_minutes) : '—'}</span></div>} />)}
          {!f(d.late_list).length && <Empty text="—" />}</div>}
        {show('absent') && <div className={clsx('card p-4', status !== 'all' && 'lg:col-span-3')}><h3 className="font-medium text-sm mb-2 flex items-center gap-2">{tr("Кто отсутствует (")}{f(d.absent_list).length})</h3>
          {f(d.absent_list).map((x: Item) => <Row key={x.employee_id} x={x} />)}{!f(d.absent_list).length && <Empty text="—" />}</div>}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2"><h3 className="font-medium text-sm mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />{tr("Проблемные сегодня (")}{problems.length})</h3>
          <div className="grid sm:grid-cols-2 gap-x-6">{f(problems).map((x: Item) => <Row key={x.employee_id} x={x} extra={<span className={clsx('text-xs whitespace-nowrap', x.status === 'absent' ? 'text-danger' : 'text-warning')}>{x.problem_reason}</span>} />)}</div>
          {!problems.length && <Empty text={tr("Проблем нет")} />}</div>
        <div className="card p-4">
          <div className="flex items-center justify-between"><h3 className="font-medium text-sm">{tr("Сейчас на работе")}</h3><span className="text-xs text-muted">{tr("обновляется")}</span></div>
          <div className="h-36 relative"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pie} dataKey="v" innerRadius={45} outerRadius={62} paddingAngle={3} stroke="none">{pie.map((p, i) => <Cell key={i} fill={p.c} />)}</Pie></PieChart></ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><div className="text-2xl font-bold">{d.on_site_now}</div><div className="text-[10px] uppercase text-muted">{tr("на работе")}</div></div></div>
          <div className="text-xs text-muted text-center">{tr("Вошли, но ещё не вышли · Ушли сегодня:")} {d.left_today}</div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">{[[tr("На работе"), d.on_site_now, 'text-success'], [tr("Ушли"), d.left_today, ''], [tr("Не пришли"), d.absent, 'text-danger']].map(([l, v, c]) => <div key={String(l)} className="rounded-xl bg-elevated p-2"><div className="text-muted">{l}</div><div className={clsx('font-bold text-base', c)}>{v}</div><div className="text-[10px] text-muted">{d.attendance_total ? Math.round((Number(v) / d.attendance_total) * 1000) / 10 : 0}%</div></div>)}</div>
          <button className="btn-ghost btn-sm w-full mt-2" onClick={() => setByDep(!byDep)}>{byDep ? tr("Скрыть") : tr("Показать")} {tr("список по отделам")}</button>
          {byDep && <div className="mt-2 space-y-1 max-h-60 overflow-auto">{Object.entries((d.on_site_list as Item[]).reduce((acc: Record<string, Item[]>, x) => { (acc[x.department_name ?? '—'] ||= []).push(x); return acc }, {})).map(([k, v]) => <div key={k}><div className="text-[10px] uppercase text-muted mt-1">{k} · {v.length}</div>{v.map((x) => <div key={x.employee_id} className="text-xs flex justify-between"><span>{x.full_name}</span><span className="text-muted">{x.check_in_time}</span></div>)}</div>)}</div>}
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="p-4 flex items-center justify-between"><h3 className="font-medium text-sm">{tr("Журнал входа и выхода")}</h3><span className="text-xs text-muted">{fmtDate(date)} · {logs.data?.count ?? 0} {tr("событий")}</span></div>
        <table className="table"><thead><tr><th>{tr("Сотрудник")}</th><th>{tr("Время")}</th><th>{tr("Тип")}</th><th>{tr("Устройство")}</th></tr></thead><tbody>
          {(logs.data?.items ?? []).map((x: { id: number; employee_id: number; employee_name: string; avatar_url: string | null; position: string; department_name: string | null; event_time: string; direction: string; device_label: string; source: string }) => (
            <tr key={x.id} className="cursor-pointer" onClick={() => setOpen(x.employee_id)}><td><div className="flex items-center gap-2"><Avatar name={x.employee_name} src={x.avatar_url} size={30} /><div><div className="font-medium">{x.employee_name}</div><div className="text-xs text-muted">{[x.position, x.department_name].filter(Boolean).join(' · ') || '—'}</div></div></div></td><td className="font-medium tabular-nums">{fmtTime(x.event_time)}</td><td><span className={x.direction === 'in' ? 'badge-green' : 'badge-red'}>{x.direction === 'in' ? tr("Вход") : tr("Выход")}</span></td><td className="text-xs text-muted">{x.device_label || x.source}</td></tr>
          ))}
        </tbody></table>{!logs.data?.items?.length && <Empty text={tr("Событий нет")} />}
      </div>
      {open && <EmployeeDrawer employeeId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
