import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { Bell, Check, Clock, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import { Avatar, Confirm, Empty, Field, Kpi, Modal, Select, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui'
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { EmployeeDrawer } from './EmployeeDrawer'

type Req = { id: number; employee_id: number; employee_name: string; department_name: string | null; position_name: string | null; kind: string; request_date: string; late_minutes: number; expected_time: string | null; reason: string; photo_url: string | null; status: string; submitted_via: string; decided_by: string | null; decided_at: string | null; decision_comment: string; created_at: string }
const S: Record<string, string> = { pending: tr("Ожидает"), approved: tr("Принято"), rejected: tr("Отклонено") }

export function NotificationsPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [section, setSection] = useState<'requests' | 'subs'>('requests')
  const [tab, setTab] = useState('pending')
  const [open, setOpen] = useState<number | null>(null)
  const [create, setCreate] = useState(false)
  const [del, setDel] = useState<number | null>(null)
  const [decide, setDecide] = useState<{ req: Req; decision: string } | null>(null)
  const [comment, setComment] = useState('')
  const req = useQuery({ queryKey: ['requests', tab], queryFn: async () => (await api.get('/absence-requests', { params: { status: tab } })).data as { items: Req[]; counts: Record<string, number> }, enabled: section === 'requests' })
  const subs = useQuery({ queryKey: ['subs', tab], queryFn: async () => (await api.get('/attendance-feed-subscribers', { params: { status: tab } })).data as { items: { id: number; bot_kind: string; chat_id: string; username: string; full_name: string; status: string; created_at: string }[]; counts: Record<string, number> }, enabled: section === 'subs' })
  const decideM = useMutation({ mutationFn: async (d: { id: number; decision: string; comment: string }) => api.post(`/absence-requests/${d.id}/decide`, d), onSuccess: () => { toast.push(tr("Решение сохранено")); setDecide(null); setComment(''); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const decideSub = useMutation({ mutationFn: async (d: { id: number; decision: string }) => api.post(`/attendance-feed-subscribers/${d.id}/decide`, d), onSuccess: () => qc.invalidateQueries() })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/absence-requests/${id}`), onSuccess: () => { setDel(null); qc.invalidateQueries() } })
  const counts = section === 'requests' ? req.data?.counts : subs.data?.counts
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  const canEdit = role === 'admin' || role === 'hr'
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-lg font-semibold">{tr("Уведомления")}</h1><p className="text-sm text-muted">{section === 'requests' ? tr("Сотрудники отправляют из Telegram: «Не смогу прийти» или «Опаздываю» + причина + фото. Примите (без штрафа) или отклоните (штраф).") : tr("Пользователи нажали /start в боте посещаемости или боте опозданий. После принятия они получают уведомления.")}</p></div>{canEdit && section === 'requests' && <button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />{tr("Создать заявку")}</button>}</div>
      <Tabs value={section} onChange={(v) => { setSection(v); setTab('pending') }} items={[{ value: 'requests', label: tr("Заявки на отсутствие") }, { value: 'subs', label: tr("Подписка на боты") }]} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Ожидают")} icon={<Clock />} value={counts?.pending ?? 0} tone="warning" onClick={() => setTab('pending')} active={tab === 'pending'} />
        <Kpi label={tr("Приняты")} icon={<Check />} value={counts?.approved ?? 0} tone="success" onClick={() => setTab('approved')} active={tab === 'approved'} />
        <Kpi label={tr("Отклонены")} icon={<X />} value={counts?.rejected ?? 0} tone="danger" onClick={() => setTab('rejected')} active={tab === 'rejected'} />
        <Kpi label={tr("Всего")} icon={<Bell />} value={total} onClick={() => setTab('all')} active={tab === 'all'} />
      </div>
      {section === 'requests' ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {req.isLoading ? <Spinner /> : (req.data?.items ?? []).map((r) => (
            <div key={r.id} className="card p-4 space-y-2">
              <div className="flex items-start gap-3"><Avatar name={r.employee_name} size={40} /><div className="flex-1 min-w-0"><div className="font-semibold cursor-pointer hover:text-accent" onClick={() => setOpen(r.employee_id)}>{r.employee_name}</div><div className="text-xs text-muted">{[r.position_name, r.department_name].filter(Boolean).join(' · ') || '—'}</div></div><StatusBadge status={r.status} label={S[r.status]} /></div>
              <div className="flex items-center gap-2 text-sm"><span className={r.kind === 'late' ? 'badge-yellow' : 'badge-red'}>{r.kind === 'late' ? tr("⏰ Опаздываю · {{v0}} мин", { v0: r.late_minutes }) : tr("🚫 Не смогу прийти")}</span><span className="font-medium">{fmtDate(r.request_date)}</span>{r.expected_time && <span className="text-muted">🕐 {r.expected_time.slice(0, 5)}</span>}</div>
              {r.reason && <p className="text-sm bg-elevated rounded-xl p-2">{r.reason}</p>}
              {r.photo_url && <img src={r.photo_url} className="rounded-xl max-h-40 object-cover" />}
              <div className="text-xs text-muted">{tr("Отправлено:")} {fmtDateTime(r.created_at)} · {r.submitted_via}{r.decided_by && <> {tr("· Решение:")} {r.decided_by} {fmtDateTime(r.decided_at)}</>}{r.decision_comment && <div>💬 {r.decision_comment}</div>}</div>
              {canEdit && <div className="flex gap-2 pt-1">
                {r.status === 'pending' ? <><button className="btn-primary btn-sm flex-1" onClick={() => setDecide({ req: r, decision: 'approved' })}><Check className="h-3.5 w-3.5" />{tr("Принять")}</button><button className="btn-danger btn-sm flex-1" onClick={() => setDecide({ req: r, decision: 'rejected' })}><X className="h-3.5 w-3.5" />{tr("Отклонить")}</button></>
                  : <button className="btn-secondary btn-sm" onClick={() => setDecide({ req: r, decision: r.status === 'approved' ? 'rejected' : 'approved' })}>{tr("Изменить решение")}</button>}
                {role === 'admin' && <button className="btn-ghost btn-sm text-danger ml-auto" onClick={() => setDel(r.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>}
            </div>
          ))}
          {!req.isLoading && !req.data?.items.length && <div className="card md:col-span-2 xl:col-span-3"><Empty text={tr("Нет заявок в этой категории")} icon={<Bell className="h-8 w-8" />} /></div>}
        </div>
      ) : (
        <div className="card overflow-hidden"><table className="table"><thead><tr><th>{tr("Пользователь")}</th><th>{tr("Бот")}</th><th>Chat ID</th><th>{tr("Дата")}</th><th>{tr("Статус")}</th>{role === 'admin' && <th />}</tr></thead><tbody>
          {(subs.data?.items ?? []).map((s) => <tr key={s.id}><td><div className="font-medium">{s.full_name || '—'}</div><div className="text-xs text-muted">{s.username && `@${s.username}`}</div></td><td>{{ attendance_feed: tr("Посещаемость"), late_absent: tr("Опоздания"), registration: tr("Регистрация") }[s.bot_kind]}</td><td className="font-mono text-xs">{s.chat_id}</td><td className="text-xs">{fmtDateTime(s.created_at)}</td><td><StatusBadge status={s.status} label={S[s.status]} /></td>
            {role === 'admin' && <td className="text-right whitespace-nowrap">{s.status !== 'approved' && <button className="btn-primary btn-sm" onClick={() => decideSub.mutate({ id: s.id, decision: 'approved' })}>{tr("Принять")}</button>}{s.status !== 'rejected' && <button className="btn-ghost btn-sm text-danger ml-1" onClick={() => decideSub.mutate({ id: s.id, decision: 'rejected' })}>{tr("Отклонить")}</button>}</td>}</tr>)}
        </tbody></table>{subs.isLoading ? <Spinner /> : !subs.data?.items.length && <Empty text={tr("Нет заявок в этой категории")} />}</div>
      )}
      {decide && <Modal open onClose={() => setDecide(null)} title={decide.decision === 'approved' ? tr("Принять заявку") : tr("Отклонить заявку")} subtitle={`${decide.req.employee_name} · ${fmtDate(decide.req.request_date)}`} size="sm" footer={<><button className="btn-secondary" onClick={() => setDecide(null)}>{tr("Отмена")}</button><button className={decide.decision === 'approved' ? 'btn-primary' : 'btn-danger'} onClick={() => decideM.mutate({ id: decide.req.id, decision: decide.decision, comment })} disabled={decideM.isPending}>{tr("Подтвердить")}</button></>}>
        <div className="text-sm text-muted mb-3">{decide.decision === 'approved' ? tr("День будет отмечен как «Уважительная причина», автоштрафы за этот день удалятся. Сотрудник получит уведомление в Telegram.") : tr("День вернётся к автоматическому расчёту — штрафы за опоздание/отсутствие применятся как обычно.")}</div>
        <Field label={tr("Комментарий сотруднику")}><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field></Modal>}
      {create && <RequestForm onClose={() => setCreate(false)} />}
      {open && <EmployeeDrawer employeeId={open} onClose={() => setOpen(null)} />}
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить заявку?")} danger />
    </div>
  )
}

function RequestForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [emp, setEmp] = useState<number | null>(null)
  const [kind, setKind] = useState<'absent' | 'late'>('absent')
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState('30')
  const employees = useQuery({ queryKey: ['employees-all'], queryFn: async () => (await api.get('/employees?per_page=500&status=active')).data.items as { id: number; full_name: string; position_name: string | null }[] })
  const m = useMutation({ mutationFn: async () => { const fd = new FormData(); fd.append('employee_id', String(emp)); fd.append('kind', kind); fd.append('request_date', date); fd.append('reason', reason); fd.append('late_minutes', kind === 'late' ? minutes : '0'); return api.post('/absence-requests', fd) }, onSuccess: () => { toast.push(tr("Заявка создана")); qc.invalidateQueries(); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  return (
    <Modal open onClose={onClose} title={tr("Создать заявку вручную")} size="sm" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!emp || m.isPending} onClick={() => m.mutate()}>{tr("Создать")}</button></>}>
      <div className="space-y-3">
        <Field label={tr("Сотрудник")}><Select value={emp} onChange={setEmp} placeholder={tr("Выберите...")} options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.full_name, hint: e.position_name ?? undefined }))} /></Field>
        <Tabs value={kind} onChange={setKind} items={[{ value: 'absent', label: tr("Не сможет прийти") }, { value: 'late', label: tr("Опоздание") }]} />
        <Field label={tr("Дата")}><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'late' && <Field label={tr("Минут опоздания")}><input type="number" className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>}
        <Field label={tr("Причина")}><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
