import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { BadgeCheck, ChevronLeft, ChevronRight, Download, Gift, Loader2, Plus, RotateCcw, Trash2, TrendingDown, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Line, LineChart, XAxis, YAxis } from 'recharts'
import { api, errorMessage } from '@/api/client'
import { Avatar, Confirm, Empty, Field, Kpi, Modal, MoneyInput, Select, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui'
import { MONTHS, fmtDate, fmtDateTime, hm, money, monthRange, signedMoney, todayISO, rateSuffix } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { EmployeeDrawer } from './EmployeeDrawer'

export const TX_LABEL: Record<string, string> = { salary: tr("Начисление"), bonus: tr("Бонус"), fine: tr("Штраф"), payment: tr("Выплата") }
const TX_TITLE: Record<string, string> = { salary: tr("Начислить зарплату"), bonus: tr("Добавить бонус"), fine: tr("Добавить штраф"), payment: tr("Выплатить зарплату") }
const PAY_REASONS = [tr("Зарплата"), tr("Аванс"), tr("Премия"), tr("Отпускные")]

export function usePeriod() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [custom, setCustom] = useState<{ date_from: string; date_to: string } | null>(null)
  const range = custom ?? monthRange(year, month)
  const prev = () => { setCustom(null); if (month === 1) { setMonth(12); setYear(year - 1) } else setMonth(month - 1) }
  const next = () => { setCustom(null); if (month === 12) { setMonth(1); setYear(year + 1) } else setMonth(month + 1) }
  const quick = (days: number) => { const to = new Date(); const from = new Date(); from.setDate(to.getDate() - days + 1); setCustom({ date_from: from.toISOString().slice(0, 10), date_to: to.toISOString().slice(0, 10) }) }
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = d.toISOString().slice(0, 10); setCustom({ date_from: s, date_to: s }) }
  return { year, month, range, prev, next, quick, yesterday, custom, setCustom, label: custom ? `${fmtDate(custom.date_from)} – ${fmtDate(custom.date_to)}` : `${MONTHS[month - 1]} ${year}` }
}

export function PeriodBar({ p }: { p: ReturnType<typeof usePeriod> }) {
  const [customOpen, setCustomOpen] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="card inline-flex items-center"><button className="btn-ghost btn-sm" onClick={p.prev}><ChevronLeft className="h-4 w-4" /></button><span className="text-sm font-medium min-w-36 text-center">{p.label}</span><button className="btn-ghost btn-sm" onClick={p.next}><ChevronRight className="h-4 w-4" /></button></div>
      <Select className="w-40" value={p.custom ? 'custom' : 'month'} onChange={(v) => { if (v === 'month') { p.setCustom(null); setCustomOpen(false) } else if (v === 'today') p.quick(1); else if (v === 'yesterday') p.yesterday(); else if (v === '7') p.quick(7); else if (v === '30') p.quick(30); else setCustomOpen(true) }}
        options={[{ value: 'month', label: tr("Месяц") }, { value: 'today', label: tr("Сегодня") }, { value: 'yesterday', label: tr("Вчера") }, { value: '7', label: tr("7 дней") }, { value: '30', label: tr("30 дней") }, { value: 'custom', label: tr("Свой период…") }]} />
      {(customOpen || p.custom) && <div className="flex items-center gap-1 text-xs text-muted"><input type="date" className="input !w-auto !py-1" value={p.range.date_from} onChange={(e) => p.setCustom({ ...p.range, date_from: e.target.value })} /><span>—</span><input type="date" className="input !w-auto !py-1" value={p.range.date_to} onChange={(e) => p.setCustom({ ...p.range, date_to: e.target.value })} /></div>}
    </div>
  )
}

export function TransactionModal({ open, onClose, type, employeeId, defaultAmount, onDone }: { open: boolean; onClose: () => void; type: 'salary' | 'bonus' | 'fine' | 'payment'; employeeId?: number; defaultAmount?: number; onDone?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [emp, setEmp] = useState<number | null>(employeeId ?? null)
  const [amount, setAmount] = useState(defaultAmount ? String(Math.round(defaultAmount)) : '')
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [accrueMode, setAccrueMode] = useState(type === 'salary')
  const employees = useQuery({ queryKey: ['employees-all'], queryFn: async () => (await api.get('/employees?per_page=500&status=active')).data.items as { id: number; full_name: string; position_name: string | null }[] })
  const m = useMutation({
    mutationFn: async () => {
      if (type === 'salary' && accrueMode) { const d = new Date(date); return (await api.post(`/payroll/accrue-salary/${emp}`, { year: d.getFullYear(), month: d.getMonth() + 1 })).data }
      return (await api.post('/payroll/transactions', { employee_id: emp, type, amount: Number(amount), tx_date: date, reason, comment })).data
    },
    onSuccess: (d) => { toast.push(type === 'salary' && accrueMode ? tr("Начислено {{v0}}", { v0: money(d.amount) }) : tr("Операция добавлена")); qc.invalidateQueries(); onDone?.(); onClose() },
    onError: (e) => toast.push(errorMessage(e), 'error'),
  })
  return (
    <Modal open={open} onClose={onClose} title={TX_TITLE[type]} size="sm" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!emp || (!accrueMode && !amount) || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Добавить")}</button></>}>
      <div className="space-y-3">
        <Field label={tr("Сотрудник")}><Select value={emp} onChange={setEmp} placeholder={tr("Выберите...")} options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.full_name, hint: e.position_name ?? undefined }))} disabled={!!employeeId} /></Field>
        {type === 'salary' && <Tabs value={accrueMode ? 'auto' : 'manual'} onChange={(v) => setAccrueMode(v === 'auto')} items={[{ value: 'auto', label: tr("Авторасчёт за месяц") }, { value: 'manual', label: tr("Сумма вручную") }]} />}
        {!(type === 'salary' && accrueMode) && <Field label={tr("Сумма")}><MoneyInput value={amount} onChange={setAmount} /></Field>}
        <Field label={type === 'salary' && accrueMode ? tr("Месяц начисления") : tr("Дата")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {!(type === 'salary' && accrueMode) && <Field label={tr("Причина")}>
          {type === 'payment' && <div className="flex flex-wrap gap-1 mb-1">{PAY_REASONS.map((r) => <button key={r} type="button" className={clsx('btn-secondary btn-sm', reason === r && '!bg-accent !text-white')} onClick={() => setReason(r)}>{r}</button>)}</div>}
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'fine' ? tr("Например: опоздание") : type === 'bonus' ? tr("Например: премия за месяц") : tr("Или введите свою причину")} /></Field>}
        <Field label={tr("Комментарий")}><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("Дополнительная информация")} /></Field>
      </div>
    </Modal>
  )
}

type Tab = 'salary' | 'fine' | 'bonus' | 'history'

export function PayrollPage() {
  const { role } = useAuth()
  const period = usePeriod()
  const [tab, setTab] = useState<Tab>('salary')
  const [dep, setDep] = useState<number | null>(null)
  const [modal, setModal] = useState<null | 'salary' | 'bonus' | 'fine' | 'payment'>(null)
  const [openEmp, setOpenEmp] = useState<number | null>(null)
  const isAdmin = role === 'admin'
  const departments = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as { id: number; name: string }[] })
  const stats = useQuery({ queryKey: ['payroll-stats', period.range], queryFn: async () => (await api.get('/payroll/stats', { params: period.range })).data })

  const exportCsv = (rows: string[][], name: string) => {
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click()
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">{tr("Расчёты")}</h1><p className="text-sm text-muted">{tr("Зарплаты, штрафы и бонусы ·")} {period.label}</p></div>
        <div className="flex gap-2">
          {isAdmin && <button className="btn-secondary" onClick={() => setModal('payment')}><Wallet className="h-4 w-4" />{tr("Выплатить")}</button>}
          {isAdmin && <button className="btn-primary" onClick={() => setModal(tab === 'fine' ? 'fine' : tab === 'bonus' ? 'bonus' : 'salary')}><Plus className="h-4 w-4" />{tr("Начислить")}</button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'salary', label: tr("Зарплата") }, { value: 'fine', label: tr("Штрафы"), count: stats.data?.by_type.fine.count }, { value: 'bonus', label: tr("Бонусы"), count: stats.data?.by_type.bonus.count }, { value: 'history', label: tr("История") }]} />
        <Select value={dep} onChange={setDep} className="w-52" placeholder={tr("Все подразделения")} options={[{ value: null, label: tr("Все подразделения") }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
      </div>
      <PeriodBar p={period} />
      <div className="grid lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-4">
          {tab === 'salary' && <SalaryTable range={period.range} dep={dep} onOpen={setOpenEmp} onExport={exportCsv} />}
          {(tab === 'fine' || tab === 'bonus') && <TxTable type={tab} range={period.range} onOpen={setOpenEmp} onExport={exportCsv} stats={stats.data} />}
          {tab === 'history' && <TxTable type={null} range={period.range} onOpen={setOpenEmp} onExport={exportCsv} stats={stats.data} />}
        </div>
        <div className="space-y-4">
          <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Динамика")}</h3>
            <div className="h-36"><ResponsiveContainer width="100%" height="100%"><LineChart data={stats.data?.series ?? []} margin={{ left: -30, right: 4 }}><XAxis dataKey="date" tickFormatter={(d) => d.slice(8)} fontSize={9} stroke="var(--text-subtle)" /><YAxis fontSize={9} stroke="var(--text-subtle)" tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} /><Line type="monotone" dataKey="salary" name={tr("Начисления")} stroke="var(--accent)" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="fine" name={tr("Штрафы")} stroke="var(--danger)" dot={false} /><Line type="monotone" dataKey="bonus" name={tr("Бонусы")} stroke="var(--success)" dot={false} /><Line type="monotone" dataKey="payment" name={tr("Выплаты")} stroke="var(--warning)" dot={false} /></LineChart></ResponsiveContainer></div></div>
          <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Структура выплат")}</h3>
            {stats.data && <FundPie data={[{ name: tr("Бонусы"), value: +stats.data.by_type.bonus.sum, color: '#16a34a' }, { name: tr("Штрафы"), value: +stats.data.by_type.fine.sum, color: '#dc2626' }, { name: tr("Начисления"), value: +stats.data.by_type.salary.sum, color: '#2563eb' }, { name: tr("Выплаты"), value: +stats.data.by_type.payment.sum, color: '#d97706' }]} />}</div>
          {tab === 'fine' && stats.data?.fine_breakdown?.length > 0 && <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Распределение штрафов")}</h3><FundPie data={stats.data.fine_breakdown.map((b: { label: string; sum: string }, i: number) => ({ name: b.label, value: +b.sum, color: ['#dc2626', '#d97706', '#7c3aed', '#0891b2', '#64748b'][i % 5] }))} /></div>}
          <RecentActions onOpen={setOpenEmp} />
        </div>
      </div>
      {modal && <TransactionModal open type={modal} onClose={() => setModal(null)} />}
      {openEmp && <EmployeeDrawer employeeId={openEmp} onClose={() => setOpenEmp(null)} />}
    </div>
  )
}

function FundPie({ data }: { data: { name: string; value: number; color: string }[] }) {
  const items = data.filter((d) => d.value > 0)
  const total = items.reduce((a, b) => a + b.value, 0)
  if (!total) return <Empty text={tr("Нет операций")} />
  return (
    <div>
      <div className="h-36"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={items} dataKey="value" innerRadius={40} outerRadius={60} paddingAngle={3} stroke="none">{items.map((d, i) => <Cell key={i} fill={d.color} />)}</Pie><Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} /></PieChart></ResponsiveContainer></div>
      <div className="space-y-1 text-xs">{items.map((d) => <div key={d.name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: d.color }} /><span className="text-muted flex-1">{d.name}</span><span className="font-medium">{Math.round((d.value / total) * 100)}%</span></div>)}</div>
    </div>
  )
}

function RecentActions({ onOpen }: { onOpen: (id: number) => void }) {
  const q = useQuery({ queryKey: ['tx-recent'], queryFn: async () => (await api.get('/payroll/transactions?per_page=6')).data })
  return (
    <div className="card p-4"><h3 className="font-medium text-sm mb-2">{tr("Последние действия")}</h3>
      <div className="space-y-2">{(q.data?.items ?? []).map((x: { id: number; employee_id: number; employee_name: string; reason: string; tx_date: string; signed_amount: string }) => (
        <div key={x.id} className="text-xs cursor-pointer hover:bg-accent-soft rounded-lg p-1.5 -m-1.5" onClick={() => onOpen(x.employee_id)}><div className="flex justify-between gap-2"><span className="font-medium truncate">{x.employee_name}</span><span className={clsx('font-semibold tabular-nums', +x.signed_amount < 0 ? 'text-danger' : 'text-success')}>{signedMoney(x.signed_amount)}</span></div><div className="text-muted truncate">{x.reason || '—'} · {fmtDate(x.tx_date)}</div></div>
      ))}{!q.data?.items?.length && <Empty text={tr("Нет операций")} />}</div></div>
  )
}

function SalaryTable({ range, dep, onOpen, onExport }: { range: { date_from: string; date_to: string }; dep: number | null; onOpen: (id: number) => void; onExport: (rows: string[][], name: string) => void }) {
  const q = useQuery({ queryKey: ['payroll', range, dep], queryFn: async () => (await api.get('/payroll', { params: { ...range, department_id: dep ?? undefined } })).data })
  if (q.isLoading) return <Spinner />
  const items = q.data?.items ?? []
  const t = q.data?.totals ?? {}
  type Row = { employee: { id: number; full_name: string; avatar_url: string | null; position_name: string | null; department_name: string | null }; rate_type: string | null; rate_amount: string; worked_minutes: number; scheduled_minutes: number; overtime_minutes: number; earned: string; overtime_pay: string; bonuses: string; fines: string; total: string; accrued: string; paid: string; to_pay: string }
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Общая зарплата")} value={money(+t.earned + +t.overtime_pay)} tone="accent" icon={<Wallet />} />
        <Kpi label={tr("После штрафов и бонусов")} value={money(t.total)} tone="success" icon={<BadgeCheck />} />
        <Kpi label={tr("Штрафы")} value={money(t.fines)} tone="danger" icon={<TrendingDown />} />
        <Kpi label={tr("Бонусы")} value={money(t.bonuses)} tone="violet" icon={<Gift />} />
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted"><span>{tr("Показано:")} {items.length}</span><button className="btn-ghost btn-sm" onClick={() => onExport([[tr("Сотрудник"), tr("Должность"), tr("Ставка"), tr("Часы"), tr("Норма"), tr("Начислено"), tr("Бонус"), tr("Штраф"), tr("Итого")], ...items.map((r: Row) => [r.employee.full_name, r.employee.position_name ?? '', r.rate_amount, hm(r.worked_minutes), hm(r.scheduled_minutes), r.earned, r.bonuses, r.fines, r.total])], 'payroll.csv')}><Download className="h-3.5 w-3.5" />CSV</button></div>
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>{tr("Сотрудник")}</th><th>{tr("Ставка")}</th><th>{tr("Часы")}</th><th className="text-right">{tr("Начислено")}</th><th className="text-right">{tr("Вне графика")}</th><th className="text-right">{tr("Бонус")}</th><th className="text-right">{tr("Штраф")}</th><th className="text-right">{tr("Итого")}</th><th className="text-right">{tr("К выплате")}</th></tr></thead><tbody>
          {items.map((r: Row) => (
            <tr key={r.employee.id} className="cursor-pointer" onClick={() => onOpen(r.employee.id)}>
              <td><div className="flex items-center gap-2"><Avatar name={r.employee.full_name} src={r.employee.avatar_url} size={34} /><div><div className="font-medium">{r.employee.full_name}</div><div className="text-xs text-muted">{[r.employee.position_name, r.employee.department_name].filter(Boolean).join(' · ') || '—'}</div></div></div></td>
              <td className="whitespace-nowrap">{r.rate_type ? tr("{{v0}}{{v1}}", { v0: money(r.rate_amount), v1: rateSuffix(r.rate_type) }) : '—'}</td>
              <td className="tabular-nums whitespace-nowrap">{hm(r.worked_minutes)} / {hm(r.scheduled_minutes)}</td>
              <td className="text-right tabular-nums">{r.rate_type ? money(r.earned) : '—'}</td>
              <td className="text-right text-xs text-muted whitespace-nowrap">{r.overtime_minutes ? tr("{{v0}} · {{v1}}", { v0: hm(r.overtime_minutes), v1: +r.overtime_pay ? money(r.overtime_pay) : tr("не оплач.") }) : tr("0 ч")}</td>
              <td className="text-right text-success tabular-nums">{+r.bonuses ? `+${money(r.bonuses)}` : '—'}</td>
              <td className="text-right text-danger tabular-nums">{+r.fines ? `−${money(r.fines)}` : '—'}</td>
              <td className="text-right font-semibold tabular-nums">{money(r.total)}</td>
              <td className={clsx('text-right tabular-nums', +r.to_pay < 0 && 'text-danger')}>{+r.accrued || +r.paid ? money(r.to_pay) : '—'}</td>
            </tr>
          ))}
        </tbody></table></div>
        {!items.length && <Empty />}
      </div>
    </>
  )
}

function TxTable({ type, range, onOpen, onExport, stats }: { type: 'fine' | 'bonus' | null; range: { date_from: string; date_to: string }; onOpen: (id: number) => void; onExport: (rows: string[][], name: string) => void; stats: { by_type: Record<string, { count: number; sum: string; employees: number }> } | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { role } = useAuth()
  const [del, setDel] = useState<number | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const q = useQuery({ queryKey: ['transactions', type, range, showDeleted], queryFn: async () => (await api.get('/payroll/transactions', { params: { ...range, tx_type: type ?? undefined, per_page: 500, include_deleted: showDeleted } })).data })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/payroll/transactions/${id}`), onSuccess: () => { toast.push(tr("Операция удалена")); qc.invalidateQueries(); setDel(null) }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const restore = useMutation({ mutationFn: async (id: number) => api.post(`/payroll/transactions/${id}/restore`), onSuccess: () => { toast.push(tr("Восстановлено")); qc.invalidateQueries() } })
  const items = q.data?.items ?? []
  const st = type ? stats?.by_type[type] : null
  type Tx = { id: number; employee_id: number; employee_name: string; position_name: string | null; type: string; reason: string; tx_date: string; created_at: string; amount: string; signed_amount: string; created_by: string; balance_after: string | null; deleted_at: string | null; auto_key: string | null }
  return (
    <>
      {st && <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={type === 'fine' ? tr("Всего штрафов") : tr("Всего бонусов")} value={money(st.sum)} tone={type === 'fine' ? 'danger' : 'success'} />
        <Kpi label={tr("Количество")} value={st.count} />
        <Kpi label={tr("Сотрудников")} value={st.employees} />
        <Kpi label={type === 'fine' ? tr("Средний штраф") : tr("Средний бонус")} value={money(st.count ? +st.sum / st.count : 0)} />
      </div>}
      {!type && stats && <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Всего операций")} value={Object.values(stats.by_type).reduce((a, b) => a + b.count, 0)} />
        <Kpi label={tr("Начисления")} value={money(stats.by_type.salary.sum)} tone="accent" />
        <Kpi label={tr("Штрафы")} value={money(stats.by_type.fine.sum)} tone="danger" />
        <Kpi label={tr("Выплаты")} value={money(stats.by_type.payment.sum)} tone="warning" />
      </div>}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted"><span>{tr("Показано:")} {items.length}</span><div className="flex items-center gap-2"><label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />{tr("удалённые")}</label><button className="btn-ghost btn-sm" onClick={() => onExport([[tr("Дата"), tr("Сотрудник"), tr("Тип"), tr("Причина"), tr("Сумма"), tr("Кто")], ...items.map((x: Tx) => [fmtDateTime(x.created_at), x.employee_name, TX_LABEL[x.type], x.reason, x.signed_amount, x.created_by])], `${type ?? 'history'}.csv`)}><Download className="h-3.5 w-3.5" />CSV</button></div></div>
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>{tr("Дата")}</th><th>{tr("Сотрудник")}</th>{!type && <th>{tr("Тип")}</th>}<th>{tr("Причина")}</th><th className="text-right">{tr("Сумма")}</th>{!type && <th className="text-right">{tr("Баланс")}</th>}<th>{tr("Кто")}</th>{role === 'admin' && <th />}</tr></thead><tbody>
          {items.map((x: Tx) => (
            <tr key={x.id} className={clsx(x.deleted_at && 'opacity-50 line-through')}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(x.created_at)}</td>
              <td className="cursor-pointer" onClick={() => onOpen(x.employee_id)}><div className="font-medium">{x.employee_name}</div><div className="text-xs text-muted">{x.position_name ?? ''}</div></td>
              {!type && <td><StatusBadge status={{ salary: 'approved', bonus: 'accepted', fine: 'rejected', payment: 'pending' }[x.type] ?? ''} label={TX_LABEL[x.type]} /></td>}
              <td className="text-xs text-muted max-w-md">{x.reason || '—'}{x.auto_key?.startsWith('auto:') && <span className="badge-gray ml-1">{tr("авто")}</span>}</td>
              <td className={clsx('text-right font-semibold tabular-nums whitespace-nowrap', +x.signed_amount < 0 ? 'text-danger' : 'text-success')}>{signedMoney(x.signed_amount)}</td>
              {!type && <td className="text-right tabular-nums text-xs">{x.balance_after != null ? money(x.balance_after) : '—'}</td>}
              <td className="text-xs text-muted">{x.created_by}</td>
              {role === 'admin' && <td className="text-right whitespace-nowrap">{x.deleted_at ? <button className="btn-ghost btn-sm" title={tr("Восстановить")} onClick={() => restore.mutate(x.id)}><RotateCcw className="h-3.5 w-3.5" /></button> : <button className="btn-ghost btn-sm text-danger" onClick={() => setDel(x.id)}><Trash2 className="h-3.5 w-3.5" /></button>}</td>}
            </tr>
          ))}
        </tbody></table></div>
        {q.isLoading ? <Spinner /> : !items.length && <Empty />}
      </div>
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить операцию?")} text={tr("Операция будет скрыта из расчётов. Её можно восстановить из истории.")} danger loading={remove.isPending} />
    </>
  )
}
