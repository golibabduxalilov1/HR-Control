import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '@/api/client'
import { Avatar, Confirm, Empty, Field, Modal, Select, Spinner, StatusBadge, Tabs, Toggle, useToast } from '@/components/ui'
import { MONTHS, WEEKDAYS, WEEKDAYS_FULL, fmtDate, fmtDateTime, fmtTime, hm, hmHuman, money, signedMoney, rateLabel, rateSuffix, todayISO } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { EmployeeForm } from './EmployeeForm'
import { TransactionModal, TX_LABEL } from './Payroll'

type Emp = { id: number; full_name: string; phone: string; employee_number: string; avatar_url: string | null; position_name: string | null; department_name: string | null; telegram_username: string | null; telegram_chat_id: string | null; schedule_label: string | null; schedule_mode: string; work_mode: string; status: string; hik_person_id: string | null; passport_series: string; passport_number: string; passport_issued_by: string; passport_issue_date: string | null; passport_expiry_date: string | null; pinfl: string; address: string; birth_date: string | null; hire_date: string | null }
type Day = { date: string; status: string; check_in: string | null; check_out: string | null; worked_minutes: number; scheduled_minutes: number; late_minutes: number; early_leave_minutes: number; overtime_minutes: number; is_manual: boolean; schedule_id: number | null; schedule_label: string | null; day_off_override: boolean; comment: string; is_holiday: boolean; holiday_name: string | null; events: { id: number; event_time: string; direction: string; source: string; device_label: string; hidden: boolean }[] }

export function EmployeeDrawer({ employeeId, onClose }: { employeeId: number; onClose: () => void }) {
  const { t } = useTranslation()
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tab, setTab] = useState<'finance' | 'timesheet' | 'passes' | 'history'>('finance')
  const [edit, setEdit] = useState(false)
  const [tx, setTx] = useState<null | 'salary' | 'bonus' | 'fine' | 'payment'>(null)
  const [day, setDay] = useState<Day | null>(null)
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data })
  const finance = settings.data?.settings?.finance_enabled !== false
  const emp = useQuery({ queryKey: ['employee', employeeId], queryFn: async () => (await api.get(`/employees/${employeeId}`)).data as Emp })
  const ts = useQuery({ queryKey: ['timesheet', employeeId, year, month], queryFn: async () => (await api.get(`/timesheet/employee/${employeeId}`, { params: { year, month } })).data as { days: Day[]; summary: Record<string, number> } })
  const fin = useQuery({ queryKey: ['emp-finance', employeeId, year, month], queryFn: async () => (await api.get(`/payroll/employee/${employeeId}`, { params: { year, month } })).data, enabled: finance })
  const canEdit = role === 'admin' || role === 'hr'
  const prev = () => { if (month === 1) { setMonth(12); setYear(year - 1) } else setMonth(month - 1) }
  const next = () => { if (month === 12) { setMonth(1); setYear(year + 1) } else setMonth(month + 1) }
  useEffect(() => { if (!finance) setTab('timesheet') }, [finance])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && !day && !edit && !tx && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose, day, edit, tx])

  const pushHik = useMutation({ mutationFn: async () => (await api.post(`/integrations/hikcentral/push-person/${employeeId}`)).data, onSuccess: (d) => { toast.push(tr("Отправлено в HikCentral · ID {{v0}}", { v0: d.hik_person_id })); qc.invalidateQueries({ queryKey: ['employee', employeeId] }) }, onError: (e) => toast.push(errorMessage(e), 'error') })

  const e = emp.data
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div className="relative h-full w-full max-w-4xl bg-main shadow-2xl overflow-y-auto animate-fade-in">
        {!e ? <Spinner /> : (
          <>
            <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-line px-5 py-4">
              <div className="flex items-start gap-4">
                <Avatar name={e.full_name} src={e.avatar_url} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-semibold truncate">{e.full_name}</h2><StatusBadge status={e.status} label={t(`status.${e.status}`)} />{canEdit && <button className="btn-ghost btn-sm" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" />{tr("Редактировать")}</button>}</div>
                  <div className="text-sm text-muted mt-0.5">{[e.position_name, e.department_name, e.phone].filter(Boolean).join(' · ') || '—'} {tr("· Таб. №")} {e.employee_number}</div>
                  <div className="flex flex-wrap gap-2 mt-2 text-xs">
                    {e.telegram_username ? <a className="badge-blue" href={`https://t.me/${e.telegram_username}`} target="_blank" rel="noreferrer"><Send className="h-3 w-3" />@{e.telegram_username}</a> : <span className="badge-gray">{tr("Telegram не подключён")}</span>}
                    <span className="badge-gray">{e.schedule_mode === 'flexible' ? tr("Без графика") : e.schedule_mode === 'two_shifts' ? tr("Два графика") : tr("Фиксированный")} · {e.schedule_label}</span>
                    <span className="badge-gray">{{ office: tr("Офис (терминал)"), remote: tr("Удалённо"), hybrid: tr("Гибрид") }[e.work_mode]}</span>
                    {e.hik_person_id && <span className="badge-gray">Hik ID {e.hik_person_id}</span>}
                  </div>
                  {(e.passport_number || e.pinfl) && <div className="text-xs text-muted mt-1.5">{e.passport_number && <>{tr("Паспорт")} {e.passport_series}{e.passport_number}{e.passport_issued_by && `, ${e.passport_issued_by}`}{e.passport_issue_date && `, ${fmtDate(e.passport_issue_date)}`}{e.passport_expiry_date && tr(" — до {{v0}}", { v0: fmtDate(e.passport_expiry_date) })}</>}{e.pinfl && <> {tr("· ПИНФЛ")} {e.pinfl}</>}{e.birth_date && <> {tr("· род.")} {fmtDate(e.birth_date)}</>}</div>}
                </div>
                <button className="btn-ghost btn-sm" onClick={onClose}><X className="h-5 w-5" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {finance && role === 'admin' && <>
                  <button className="btn-primary btn-sm" onClick={() => setTx('salary')}><Wallet className="h-3.5 w-3.5" />{tr("Начислить зарплату")}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setTx('bonus')}>{tr("Добавить бонус")}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setTx('fine')}>{tr("Добавить штраф")}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setTx('payment')}>{tr("Выплатить")}</button>
                </>}
                {settings.data?.settings?.hik_enabled && canEdit && <button className="btn-secondary btn-sm" onClick={() => pushHik.mutate()} disabled={pushHik.isPending}>{pushHik.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{tr("Обновить в Hik")}</button>}
                <div className="ml-auto flex items-center gap-1"><button className="btn-ghost btn-sm" onClick={prev}><ChevronLeft className="h-4 w-4" /></button><span className="text-sm font-semibold min-w-32 text-center">{MONTHS[month - 1]} {year}</span><button className="btn-ghost btn-sm" onClick={next}><ChevronRight className="h-4 w-4" /></button></div>
              </div>
              <Tabs className="mt-3" value={tab} onChange={setTab} items={[...(finance ? [{ value: 'finance' as const, label: tr("Финансы и начисления") }] : []), { value: 'timesheet' as const, label: tr("Табель") }, { value: 'passes' as const, label: tr("Проходы") }, { value: 'history' as const, label: tr("История") }]} />
            </div>
            <div className="p-5 space-y-4">
              {tab === 'finance' && finance && <FinanceTab data={fin.data} loading={fin.isLoading} ts={ts.data} />}
              {tab === 'timesheet' && <TimesheetTab data={ts.data} loading={ts.isLoading} onDay={(d) => canEdit && setDay(d)} year={year} month={month} />}
              {tab === 'passes' && <PassesTab employeeId={employeeId} year={year} month={month} canEdit={canEdit} onDay={(d) => { const found = ts.data?.days.find((x) => x.date === d); if (found && canEdit) setDay(found) }} />}
              {tab === 'history' && <HistoryTab employeeId={employeeId} />}
            </div>
          </>
        )}
      </div>
      {edit && e && <EmployeeForm employeeId={e.id} onClose={() => setEdit(false)} onSaved={() => { qc.invalidateQueries(); setEdit(false) }} />}
      {tx && <TransactionModal open type={tx} employeeId={employeeId} defaultAmount={tx === 'payment' ? +(fin.data?.to_pay ?? 0) : undefined} onClose={() => setTx(null)} />}
      {day && e && <DayEditor employee={e} day={day} onClose={() => setDay(null)} onSaved={() => { qc.invalidateQueries(); setDay(null) }} />}
    </div>,
    document.body,
  )
}

type PieceRow = { id: number; work_date: string; quantity: string; note: string }

/** Выработка сдельщика за период: список записей, добавление, удаление */
function PieceworkPanel({ employeeId, from, to }: { employeeId: number; from: string; to: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'hr'
  const [date, setDate] = useState(todayISO())
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const q = useQuery({ queryKey: ['piecework', employeeId, from, to], queryFn: async () => (await api.get(`/employees/${employeeId}/piecework`, { params: { date_from: from, date_to: to } })).data as { items: PieceRow[]; total_quantity: string } })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['piecework', employeeId] }); qc.invalidateQueries({ queryKey: ['emp-finance', employeeId] }); qc.invalidateQueries({ queryKey: ['payroll'] }) }
  const add = useMutation({ mutationFn: async () => api.post(`/employees/${employeeId}/piecework`, { work_date: date, quantity: Number(qty.replace(',', '.')), note }), onSuccess: () => { setQty(''); setNote(''); toast.push(tr("Выработка добавлена")); refresh() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const del = useMutation({ mutationFn: async (id: number) => api.delete(`/employees/${employeeId}/piecework/${id}`), onSuccess: refresh, onError: (e) => toast.push(errorMessage(e), 'error') })
  return (
    <div className="card p-4 md:col-span-2">
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">{tr("Выработка")}</h3><span className="text-sm text-muted">{tr("Итого:")} <b className="text-ink">{Number(q.data?.total_quantity ?? 0)}</b> {tr("ед.")}</span></div>
      {canEdit && (
        <form className="grid sm:grid-cols-[auto_1fr_2fr_auto] gap-2 items-end mb-3" onSubmit={(e) => { e.preventDefault(); if (Number(qty.replace(',', '.')) > 0) add.mutate() }}>
          <Field label={tr("Дата")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={tr("Количество")}><input className="input tabular-nums" inputMode="decimal" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
          <Field label={tr("Примечание")}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("что сделано")} /></Field>
          <button className="btn-secondary" disabled={!(Number(qty.replace(',', '.')) > 0) || add.isPending}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{tr("Добавить")}</button>
        </form>
      )}
      {q.isLoading ? <Spinner /> : q.data?.items.length ? (
        <table className="table text-sm"><thead><tr><th>{tr("Дата")}</th><th className="text-right">{tr("Количество")}</th><th>{tr("Примечание")}</th>{canEdit && <th />}</tr></thead><tbody>
          {q.data.items.map((r) => (
            <tr key={r.id}><td className="tabular-nums">{fmtDate(r.work_date)}</td><td className="text-right font-medium tabular-nums">{Number(r.quantity)}</td><td className="text-muted">{r.note || '—'}</td>
              {canEdit && <td className="text-right"><button className="btn-ghost btn-sm !px-2 text-danger" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></button></td>}</tr>
          ))}
        </tbody></table>
      ) : <Empty text={tr("За период выработка не внесена")} />}
    </div>
  )
}

function FinanceTab({ data, loading, ts }: { data: Record<string, number | string> | undefined; loading: boolean; ts: { summary: Record<string, number> } | undefined }) {
  if (loading || !data) return <Spinner />
  const d = data
  const worked = Number(d.worked_minutes), sched = Number(d.scheduled_minutes)
  const extra = Math.max(worked - sched, 0)
  const piece = d.rate_type === 'piece'
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold">{tr("Финансы и начисления")} <span className="text-xs text-muted font-normal">{fmtDate(String(d.date_from))} – {fmtDate(String(d.date_to))}</span></h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-elevated p-2"><div className="text-[10px] uppercase text-muted">{rateLabel(String(d.rate_type ?? ''))}</div><div className="font-bold text-sm">{d.rate_type ? tr("{{v0}}{{v1}}", { v0: money(d.rate_amount), v1: rateSuffix(String(d.rate_type)) }) : '—'}</div></div>
          <div className="rounded-xl bg-success/10 p-2"><div className="text-[10px] uppercase text-muted">{tr("Бонусы")}</div><div className="font-bold text-sm text-success">+{money(d.bonuses)}</div></div>
          <div className="rounded-xl bg-danger/10 p-2"><div className="text-[10px] uppercase text-muted">{tr("Штрафы")}</div><div className="font-bold text-sm text-danger">−{money(d.fines)}</div></div>
        </div>
        <div className="rounded-xl border border-line p-3 text-sm space-y-1">
          {piece && <div className="flex justify-between"><span className="text-muted">{tr("Выработка")}</span><span className="font-medium">{Number(d.units)} {tr("ед.")} <span className="text-muted">× {money(d.rate_amount)}</span></span></div>}
          {!piece && <div className="flex justify-between"><span className="text-muted">{tr("По часам")}</span><span className="font-medium">{hmHuman(worked)} <span className="text-muted">{tr("из")} {hmHuman(sched)} ({d.scheduled_days} {tr("дн)")}</span></span></div>}
          {extra > 0 && <div className="flex justify-between text-xs"><span className="text-muted">{tr("лишнее")}</span><span className="text-warning">+{hmHuman(extra)} · {Number(d.overtime_pay) ? money(d.overtime_pay) : tr("не оплачивается")}</span></div>}
          <div className="flex justify-between border-t border-line pt-1 mt-1"><span className="text-muted">{tr("Заработано")}</span><span className="font-semibold">{money(Number(d.earned) + Number(d.overtime_pay))}</span></div>
          <div className="flex justify-between"><span className="text-muted">{tr("Расчёт к начислению")}</span><span className="font-bold text-accent">{money(d.total)}</span></div>
        </div>
        <div className="rounded-xl border border-line p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted">{tr("Начислено")}</span><span className="font-medium">{Number(d.accrued) ? money(d.accrued) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted">{tr("Выплачено")}</span><span className="font-medium">{Number(d.paid) ? money(d.paid) : '—'}</span></div>
          <div className="flex justify-between border-t border-line pt-1"><span className="text-muted">{tr("К выплате")}</span><span className={clsx('font-bold', Number(d.to_pay) < 0 ? 'text-danger' : 'text-success')}>{money(d.to_pay)}</span></div>
        </div>
      </div>
      {piece && <PieceworkPanel employeeId={Number(d.employee_id)} from={String(d.date_from)} to={String(d.date_to)} />}
      <div className="card p-4">
        <h3 className="font-semibold mb-3">{tr("Посещаемость")}</h3>
        <div className="grid grid-cols-2 gap-2">
          {[[tr("По графику"), tr("{{v0}} дн", { v0: d.scheduled_days }), `${hmHuman(sched)}`], [tr("Пришёл"), `${d.worked_days}`, tr("из {{v0}} дн по графику", { v0: d.scheduled_days })], [tr("Опозданий"), d.late_count, ''], [tr("Ран. уход"), d.early_count, ''], [tr("Не пришёл"), d.absent_count, ''], [tr("Уваж. причина"), d.excused_count, ''], [tr("Всего часов"), hmHuman(worked), ''], [tr("Выполнение"), ts?.summary?.completion_pct != null ? `${ts.summary.completion_pct}%` : '—', '']].map(([l, v, s]) => (
            <div key={String(l)} className="rounded-xl bg-elevated p-2.5"><div className="text-[10px] uppercase text-muted">{l}</div><div className="font-bold">{v}</div>{s && <div className="text-[10px] text-muted">{s}</div>}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimesheetTab({ data, loading, onDay, year, month }: { data: { days: Day[]; summary: Record<string, number> } | undefined; loading: boolean; onDay: (d: Day) => void; year: number; month: number }) {
  const { t } = useTranslation()
  if (loading || !data) return <Spinner />
  const first = new Date(year, month - 1, 1).getDay()
  const offset = (first + 6) % 7
  const dot: Record<string, string> = { on_time: 'border-success bg-success/10', worked_off: 'border-success bg-success/10', late: 'border-warning bg-warning/10', early_leave: 'border-warning bg-warning/10', late_early: 'border-warning bg-warning/10', absent: 'border-danger bg-danger/10', excused: 'border-info bg-info/10', remote: 'border-info bg-info/10', day_off: 'border-line bg-elevated', holiday: 'border-line bg-elevated', planned: 'border-dashed border-line', leave: 'border-line bg-elevated', dismissed: 'border-line', not_hired: 'border-line opacity-50' }
  return (
    <div className="card p-3">
      <div className="text-xs text-muted mb-2">{tr("Нажмите день в календаре для редактирования")}</div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase text-muted text-center mb-1">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }).map((_, i) => <div key={`o${i}`} />)}
        {data.days.map((d) => (
          <button key={d.date} type="button" onClick={() => onDay(d)} className={clsx('rounded-xl border p-1.5 text-left min-h-[76px] hover:ring-2 hover:ring-accent/30 transition cursor-pointer', dot[d.status] || 'border-line')}>
            <div className="flex items-center justify-between"><span className="text-sm font-bold">{+d.date.slice(8)}</span>{d.is_manual && <span className="h-1.5 w-1.5 rounded-full bg-accent" title={tr("Изменено вручную")} />}</div>
            <div className="text-[10px] text-muted truncate">{d.holiday_name ?? t(`status.${d.status}`)}</div>
            {d.check_in && <div className="text-[11px] font-medium tabular-nums">{fmtTime(d.check_in)}{d.check_out ? `–${fmtTime(d.check_out)}` : ' →'}</div>}
            {d.worked_minutes > 0 && <div className="text-[10px] text-muted">{hm(d.worked_minutes)}</div>}
            {d.late_minutes > 0 && <div className="text-[10px] text-warning">+{d.late_minutes} {tr("мин")}</div>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-3 text-[10px] text-muted">{[['bg-success', tr("Вовремя")], ['bg-warning', tr("Опоздание / ран. уход")], ['bg-danger', tr("Отсутствие")], ['bg-info', tr("Уваж. причина / удалённо")], ['bg-subtle', tr("Выходной")], ['bg-accent', tr("Изменено")]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={clsx('h-2 w-2 rounded-full', c)} />{l}</span>)}</div>
    </div>
  )
}

function PassesTab({ employeeId, year, month, canEdit, onDay }: { employeeId: number; year: number; month: number; canEdit: boolean; onDay: (d: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')
  const [del, setDel] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['pass-log', employeeId, year, month], queryFn: async () => (await api.get(`/employees/${employeeId}/pass-log`, { params: { year, month } })).data as { id: number; event_time: string; direction: string; source: string; device_label: string; hidden: boolean }[] })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/attendance/events/${id}`), onSuccess: () => { toast.push(tr("Проход скрыт")); qc.invalidateQueries(); setDel(null) } })
  const items = (q.data ?? []).filter((x) => filter === 'all' || x.direction === filter)
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between p-3"><h3 className="font-medium text-sm">{tr("Журнал прихода и ухода")}</h3><Tabs value={filter} onChange={setFilter} items={[{ value: 'all', label: tr("Все"), count: q.data?.length }, { value: 'in', label: tr("Вход"), count: q.data?.filter((x) => x.direction === 'in').length }, { value: 'out', label: tr("Выход"), count: q.data?.filter((x) => x.direction === 'out').length }]} /></div>
      <table className="table"><thead><tr><th>{tr("Дата")}</th><th>{tr("Время")}</th><th>{tr("Тип")}</th><th>{tr("Устройство")}</th><th>{tr("Источник")}</th>{canEdit && <th />}</tr></thead><tbody>
        {items.map((x) => (
          <tr key={x.id} className={clsx('cursor-pointer', x.hidden && 'opacity-40 line-through')} onClick={() => onDay(x.event_time.slice(0, 10))}>
            <td>{fmtDate(x.event_time)}</td><td className="font-medium tabular-nums">{fmtTime(x.event_time)}</td><td><span className={x.direction === 'in' ? 'badge-green' : 'badge-red'}>{x.direction === 'in' ? tr("Вход") : tr("Выход")}</span></td><td className="text-xs">{x.device_label || '—'}</td><td className="text-xs text-muted">{{ terminal: 'Face ID', telegram: 'Telegram', manual: tr("Вручную"), api: 'API' }[x.source]}</td>
            {canEdit && <td className="text-right"><button className="btn-ghost btn-sm text-danger" onClick={(e) => { e.stopPropagation(); setDel(x.id) }}><Trash2 className="h-3.5 w-3.5" /></button></td>}
          </tr>
        ))}
      </tbody></table>
      {q.isLoading ? <Spinner /> : !items.length && <Empty />}
      <div className="px-3 py-2 text-xs text-muted">{tr("Нажмите на строку — открыть день в табеле")}</div>
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Скрыть проход?")} text={tr("Проход терминала будет исключён из табеля (данные не удаляются).")} danger />
    </div>
  )
}

function HistoryTab({ employeeId }: { employeeId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { role } = useAuth()
  const [del, setDel] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['emp-history', employeeId], queryFn: async () => (await api.get(`/payroll/employee/${employeeId}/history`)).data as { id: string; kind: string; action: string; summary: string; description: string | null; amount: string | null; actor: string; created_at: string; deleted_at: string | null; tx_id?: number; is_auto?: boolean }[] })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/payroll/transactions/${id}`), onSuccess: () => { toast.push(tr("Удалено")); qc.invalidateQueries(); setDel(null) } })
  if (q.isLoading) return <Spinner />
  return (
    <div className="space-y-2">
      {(q.data ?? []).map((h) => (
        <div key={h.id} className={clsx('card p-3 flex items-start gap-3', h.deleted_at && 'opacity-50')}>
          <div className={clsx('h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold', h.kind === 'payroll' ? (h.action === 'fine' ? 'bg-danger/10 text-danger' : h.action === 'payment' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success') : 'bg-accent-soft text-accent')}>{h.kind === 'payroll' ? TX_LABEL[h.action]?.[0] : tr("Т")}</div>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-medium">{h.kind === 'payroll' ? TX_LABEL[h.action] : tr("Табель")}</span>{h.is_auto && <span className="badge-gray">{tr("Авто")}</span>}{h.deleted_at && <span className="badge-red">{tr("удалено")}</span>}</div>
            <div className="text-sm text-ink">{h.summary}</div>{h.description && <div className="text-xs text-muted">{h.description}</div>}<div className="text-xs text-muted mt-0.5">{h.actor} · {fmtDateTime(h.created_at)}</div></div>
          {h.amount != null && <div className={clsx('font-bold tabular-nums whitespace-nowrap', +h.amount < 0 ? 'text-danger' : 'text-success')}>{signedMoney(h.amount)}</div>}
          {h.kind === 'payroll' && role === 'admin' && !h.deleted_at && <button className="btn-ghost btn-sm text-danger" onClick={() => setDel(h.tx_id!)}><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!q.data?.length && <Empty />}
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить операцию?")} danger loading={remove.isPending} />
    </div>
  )
}

/* ------------------------------------------------------------------ Day editor */

export function DayEditor({ employee, day, onClose, onSaved }: { employee: Emp; day: Day; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: async () => (await api.get('/schedules')).data as { id: number; name: string; start_time: string | null; end_time: string | null; type: string }[] })
  const statuses = useQuery({ queryKey: ['day-statuses'], queryFn: async () => (await api.get('/attendance-day-statuses')).data as { id: string; label: string; enabled: boolean }[] })
  const [status, setStatus] = useState<string | null>(day.is_manual ? day.status : null)
  const [cin, setCin] = useState(day.check_in ? fmtTime(day.check_in) : '')
  const [cout, setCout] = useState(day.check_out ? fmtTime(day.check_out) : '')
  const [schedule, setSchedule] = useState<number | null>(day.schedule_id)
  const [dayOff, setDayOff] = useState(day.day_off_override)
  const [comment, setComment] = useState('')
  const [hidden, setHidden] = useState<Set<number>>(new Set(day.events.filter((e) => e.hidden).map((e) => e.id)))
  const [flip, setFlip] = useState<Set<number>>(new Set())
  const wd = WEEKDAYS_FULL[(new Date(day.date).getDay() + 6) % 7]
  const m = useMutation({
    mutationFn: async (reset: boolean) => {
      const toIso = (v: string) => (v ? new Date(`${day.date}T${v}:00`).toISOString() : null)
      const originallyHidden = new Set(day.events.filter((e) => e.hidden).map((e) => e.id))
      return api.put('/attendance/day', {
        reset, status, check_in: status || cin !== (day.check_in ? fmtTime(day.check_in) : '') ? toIso(cin) : null, check_out: status || cout !== (day.check_out ? fmtTime(day.check_out) : '') ? toIso(cout) : null,
        schedule_id: schedule ?? 0, day_off_override: dayOff, comment,
        hidden_event_ids: [...hidden].filter((id) => !originallyHidden.has(id)), unhidden_event_ids: [...originallyHidden].filter((id) => !hidden.has(id)), flip_event_ids: [...flip],
      }, { params: { employee_id: employee.id, date: day.date } })
    },
    onSuccess: () => { toast.push(tr("День сохранён")); onSaved() }, onError: (e) => toast.push(errorMessage(e), 'error'),
  })
  const sch = schedules.data?.find((s) => s.id === (schedule ?? -1))
  return (
    <Modal open onClose={onClose} title={tr("Редактирование: {{v0}} ({{v1}})", { v0: fmtDate(day.date), v1: wd })} subtitle={tr("Можно сменить график на этот день — пересчитаются опоздание и норма часов")} size="lg"
      footer={<><button className="btn-secondary" onClick={() => m.mutate(true)} disabled={m.isPending}>{tr("Сбросить к авто")}</button><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" onClick={() => m.mutate(false)} disabled={m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Сохранить")}</button></>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={tr("График на день")}><Select value={schedule} onChange={setSchedule} options={[{ value: null, label: tr("По умолчанию (график сотрудника)") }, ...(schedules.data ?? []).map((s) => ({ value: s.id, label: s.start_time ? `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time?.slice(0, 5)}` : s.name }))]} />
            {sch?.start_time && <div className="text-xs text-muted mt-1">{tr("Опоздание: вход позже")} {sch.start_time.slice(0, 5)}</div>}</Field>
          <Field label={tr("Выходной")}><Toggle checked={dayOff} onChange={setDayOff} label={tr("Считать день выходным")} hint={tr("Норма часов и штрафы на этот день не применяются")} /></Field>
        </div>
        <Field label={tr("Статус (вручную)")}><div className="flex flex-wrap gap-1.5">
          <button type="button" className={clsx('btn-secondary btn-sm', status === null && '!bg-accent !text-white')} onClick={() => setStatus(null)}>{tr("Авто")} ({t(`status.${day.status}`)})</button>
          {(statuses.data ?? []).filter((s) => s.enabled).map((s) => <button key={s.id} type="button" className={clsx('btn-secondary btn-sm', status === s.id && '!bg-accent !text-white')} onClick={() => setStatus(s.id)}>{s.label}</button>)}
        </div></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("Вход")} hint={sch?.start_time ? tr("По графику {{v0}}", { v0: sch.start_time.slice(0, 5) }) : undefined}><input type="time" className="input" value={cin} onChange={(e) => setCin(e.target.value)} /></Field>
          <Field label={tr("Выход")} hint={tr("Можно указать вход, выход или оба времени")}><input type="time" className="input" value={cout} onChange={(e) => setCout(e.target.value)} /></Field>
        </div>
        {day.events.length > 0 && <div>
          <div className="flex items-center justify-between mb-1"><label className="label !mb-0">{tr("Face ID (терминал)")}</label><div className="flex gap-1"><button type="button" className="btn-ghost btn-sm" onClick={() => setHidden(new Set())}>{tr("Выбрать все")}</button><button type="button" className="btn-ghost btn-sm" onClick={() => setHidden(new Set(day.events.map((e) => e.id)))}>{tr("Снять все")}</button></div></div>
          <div className="space-y-1">{day.events.map((e) => {
            const dir = flip.has(e.id) ? (e.direction === 'in' ? 'out' : 'in') : e.direction
            return <div key={e.id} className={clsx('flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm', hidden.has(e.id) && 'opacity-50')}>
              <input type="checkbox" checked={!hidden.has(e.id)} onChange={(ev) => { const s = new Set(hidden); ev.target.checked ? s.delete(e.id) : s.add(e.id); setHidden(s) }} />
              <span className={dir === 'in' ? 'badge-green' : 'badge-red'}>{dir === 'in' ? tr("Вход") : tr("Выход")}</span><span className="font-medium tabular-nums">{fmtTime(e.event_time)}</span><span className="text-xs text-muted flex-1 truncate">{e.device_label}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { const s = new Set(flip); s.has(e.id) ? s.delete(e.id) : s.add(e.id); setFlip(s) }}>→ {dir === 'in' ? tr("Выход") : tr("Вход")}</button>
            </div>
          })}</div>
          <div className="text-xs text-muted mt-1">{tr("Галочка — активно (в табеле). «→ Вход/Выход» — сменить тип, если сотрудник ошибся на турникете.")}</div>
        </div>}
        <Field label={tr("Комментарий")}><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("Причина изменения")} /></Field>
      </div>
    </Modal>
  )
}
