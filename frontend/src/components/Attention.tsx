import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { AlertCircle, Check, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/api/client'
import { Avatar, useToast } from '@/components/ui'
import { fmtDate, hmHuman } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { EmployeeDrawer } from '@/pages/EmployeeDrawer'

type Req = { id: number; employee_id: number; employee_name: string; kind: string; request_date: string; late_minutes: number; reason: string }
type Task = { id: number; employee_id: number; employee_name: string; title: string; bonus_amount: string }
type Person = { employee_id: number; full_name: string; avatar_url: string | null; check_in_time: string | null; late_minutes: number; problem_reason: string | null }

/** "Что требует внимания" — one panel with everything the manager has to decide today. */
export function AttentionPanel() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { slug, role } = useAuth()
  const [open, setOpen] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['attention'], queryFn: async () => (await api.get('/dashboard/attention')).data, refetchInterval: 60_000 })
  const decide = useMutation({ mutationFn: async (d: { id: number; decision: string }) => api.post(`/absence-requests/${d.id}/decide`, d), onSuccess: () => { toast.push(tr("Решение сохранено")); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const review = useMutation({ mutationFn: async (d: { id: number; decision: string }) => api.post(`/tasks/${d.id}/review`, d), onSuccess: () => { toast.push(tr("Готово")); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const canEdit = role === 'admin' || role === 'hr'
  const d = q.data
  if (!d) return null

  if (!d.setup_done && role === 'admin') return <SetupChecklist setup={d.setup} />

  const total = d.counts.requests + d.counts.tasks + d.counts.late + d.counts.absent
  if (!total) return (
    <div className="card px-5 py-4 flex items-center gap-3 text-sm" style={{ background: 'color-mix(in srgb, var(--success) 10%, var(--bg-card))' }}><span className="h-7 w-7 rounded-lg bg-success/15 text-success flex items-center justify-center"><Check className="h-4 w-4" /></span>{tr("Сегодня всё в порядке — заявок и проблем нет.")}</div>
  )

  const Row = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div className={clsx('flex items-center gap-3 py-2 text-sm', onClick && 'cursor-pointer hover:bg-elevated -mx-2 px-2 rounded-md')} onClick={onClick}>{children}</div>
  )

  return (
    <div className="card">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between"><h2 className="card-title"><span className="card-title-icon !bg-warning/14 !text-warning"><AlertCircle className="h-4 w-4" /></span>{tr("Требует внимания")}</h2><span className="badge-yellow">{total}</span></div>
      <div className="px-5 pb-4 grid md:grid-cols-2 gap-x-8 divide-y md:divide-y-0 divide-line">
        <div>
          {d.requests.length > 0 && <div className="pt-2"><div className="text-xs text-muted mb-1">{tr("Заявки ·")} {d.counts.requests}</div>
            {d.requests.map((r: Req) => (
              <Row key={r.id}>
                <div className="min-w-0 flex-1"><span className="font-medium">{r.employee_name}</span> <span className="text-muted">{r.kind === 'late' ? tr("опаздывает на {{v0}} мин", { v0: r.late_minutes }) : tr("не сможет прийти {{v0}}", { v0: fmtDate(r.request_date) })}</span>{r.reason && <div className="text-xs text-muted truncate">{r.reason}</div>}</div>
                {canEdit && <div className="flex gap-1 shrink-0"><button className="btn-secondary btn-sm" onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}><Check className="h-3.5 w-3.5" />{tr("Принять")}</button><button className="btn-ghost btn-sm text-danger" onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}><X className="h-3.5 w-3.5" /></button></div>}
              </Row>
            ))}</div>}
          {d.tasks.length > 0 && <div className="pt-2"><div className="text-xs text-muted mb-1">{tr("Задачи на проверке ·")} {d.counts.tasks}</div>
            {d.tasks.map((t: Task) => (
              <Row key={t.id}>
                <div className="min-w-0 flex-1"><span className="font-medium">{t.title}</span> <span className="text-muted">— {t.employee_name}</span></div>
                {canEdit && <div className="flex gap-1 shrink-0"><button className="btn-secondary btn-sm" onClick={() => review.mutate({ id: t.id, decision: 'approved' })}><Check className="h-3.5 w-3.5" />{tr("Подтвердить")}</button><button className="btn-ghost btn-sm text-danger" onClick={() => review.mutate({ id: t.id, decision: 'rejected' })}><X className="h-3.5 w-3.5" /></button></div>}
              </Row>
            ))}</div>}
          {!d.requests.length && !d.tasks.length && <div className="pt-2 text-sm text-muted">{tr("Нет заявок и задач на проверку")}</div>}
        </div>
        <div>
          {d.absent.length > 0 && <div className="pt-2"><div className="text-xs text-muted mb-1">{tr("Не пришли ·")} {d.counts.absent}</div>
            {d.absent.map((x: Person) => <Row key={x.employee_id} onClick={() => setOpen(x.employee_id)}><Avatar name={x.full_name} src={x.avatar_url} size={26} /><span className="flex-1 truncate">{x.full_name}</span><ChevronRight className="h-4 w-4 text-subtle" /></Row>)}
            {d.counts.absent > d.absent.length && <button className="btn-ghost btn-sm" onClick={() => nav(`/${slug}/today`)}>{tr("ещё")} {d.counts.absent - d.absent.length}</button>}</div>}
          {d.late.length > 0 && <div className="pt-2"><div className="text-xs text-muted mb-1">{tr("Опоздали ·")} {d.counts.late}</div>
            {d.late.map((x: Person) => <Row key={x.employee_id} onClick={() => setOpen(x.employee_id)}><Avatar name={x.full_name} src={x.avatar_url} size={26} /><span className="flex-1 truncate">{x.full_name}</span><span className="text-xs text-muted">{x.check_in_time} · +{hmHuman(x.late_minutes)}</span></Row>)}</div>}
          {!d.absent.length && !d.late.length && <div className="pt-2 text-sm text-muted">{tr("Все на месте")}</div>}
        </div>
      </div>
      {open && <EmployeeDrawer employeeId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SetupChecklist({ setup }: { setup: Record<string, boolean> }) {
  const nav = useNavigate()
  const { slug } = useAuth()
  const steps = [
    { key: 'employees', title: tr("Добавьте сотрудников"), text: tr("Вручную, импортом из CSV или через Telegram-бот регистрации"), to: 'employees' },
    { key: 'schedules', title: tr("Создайте график работы"), text: tr("Начало и конец смены, обед, допуск на опоздание"), to: 'schedules' },
    { key: 'schedules_assigned', title: tr("Назначьте графики сотрудникам"), text: tr("Без графика сотрудник учитывается «по факту» — без опозданий и нормы"), to: 'schedules' },
    { key: 'terminal', title: tr("Подключите терминал (HikCentral)"), text: tr("Проходы будут приходить автоматически. Пока можно отмечать вручную или через Telegram"), to: 'settings' },
    { key: 'telegram', title: tr("Подключите Telegram-бот"), text: tr("Сотрудники увидят свой табель и зарплату, смогут предупредить об опоздании"), to: 'settings' },
  ]
  const done = steps.filter((s) => setup[s.key]).length
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1"><h2 className="font-medium">{tr("Начало работы")}</h2><span className="text-xs text-muted">{done} {tr("из")} {steps.length}</span></div>
      <p className="text-sm text-muted mb-4">{tr("Три первых шага обязательны — после них табель и расчёты начнут считаться сами.")}</p>
      <div className="divide-y divide-line">
        {steps.map((s, i) => (
          <button key={s.key} className="w-full flex items-center gap-3 py-3 text-left cursor-pointer hover:bg-elevated -mx-2 px-2 rounded-md" onClick={() => nav(`/${slug}/${s.to}`)}>
            <span className={clsx('h-6 w-6 rounded-full flex items-center justify-center text-xs shrink-0', setup[s.key] ? 'bg-success text-white' : 'bg-accent-soft text-accent font-semibold')}>{setup[s.key] ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            <span className="flex-1"><span className={clsx('text-sm font-medium', setup[s.key] && 'line-through text-muted')}>{s.title}</span><span className="block text-xs text-muted">{s.text}</span></span>
            <ChevronRight className="h-4 w-4 text-subtle" />
          </button>
        ))}
      </div>
    </div>
  )
}
