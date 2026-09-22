import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { Check, ListChecks, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '@/api/client'
import { Confirm, Empty, Field, Modal, MoneyInput, Select, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui'
import { fmtDateTime, money } from '@/lib/format'
import { useAuth } from '@/store/auth'

type Task = { id: number; employee_id: number; employee_name: string; department_name: string | null; position_name: string | null; title: string; description: string; bonus_amount: string; photo_url: string | null; result_text: string; result_photo_url: string | null; status: string; created_by: string; created_at: string; accepted_at: string | null; completed_at: string | null; reviewed_at: string | null; reviewed_by: string | null }
const LABEL: Record<string, string> = { pending: tr("Ожидает"), accepted: tr("Принята"), review: tr("На проверке"), approved: tr("Подтверждена"), rejected: tr("Отклонена") }

export function TasksPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState('all')
  const [sel, setSel] = useState<number | null>(null)
  const [create, setCreate] = useState(false)
  const [del, setDel] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['tasks', tab], queryFn: async () => (await api.get('/tasks', { params: { status: tab } })).data as { items: Task[]; counts: Record<string, number>; total: number } })
  const review = useMutation({ mutationFn: async (d: { id: number; decision: string }) => api.post(`/tasks/${d.id}/review`, { decision: d.decision }), onSuccess: () => { toast.push(tr("Решение сохранено")); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/tasks/${id}`), onSuccess: () => { toast.push(tr("Задача удалена")); setDel(null); setSel(null); qc.invalidateQueries() } })
  const task = q.data?.items.find((t) => t.id === sel) ?? q.data?.items[0]
  const canEdit = role === 'admin' || role === 'hr'
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-lg font-semibold">{tr("Задачи")}</h1><p className="text-sm text-muted">{tr("Задачи сотрудникам через Telegram · бонус после подтверждения")}</p></div>{canEdit && <button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />{tr("Новая задача")}</button>}</div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'all', label: tr("Все"), count: q.data?.total }, ...['pending', 'accepted', 'review', 'approved', 'rejected'].map((s) => ({ value: s, label: LABEL[s], count: q.data?.counts[s] }))]} />
      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
        <div className="space-y-2">{q.isLoading ? <Spinner /> : (q.data?.items ?? []).map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)} className={clsx('card w-full p-3 text-left transition cursor-pointer', task?.id === t.id ? 'ring-2 ring-accent/40' : 'hover:border-accent/40')}>
            <div className="flex items-center gap-2"><span className="font-medium flex-1 truncate">{t.title}</span><StatusBadge status={t.status} label={LABEL[t.status]} /></div>
            <div className="text-xs text-muted mt-1 flex justify-between"><span>{t.employee_name}{t.department_name && ` · ${t.department_name}`}</span><span>{fmtDateTime(t.created_at)}</span></div>
            {+t.bonus_amount > 0 && <div className="text-xs text-success font-medium mt-0.5">{money(t.bonus_amount)}</div>}
          </button>))}{!q.isLoading && !q.data?.items.length && <div className="card"><Empty text={tr("Задач нет")} icon={<ListChecks className="h-8 w-8" />} /></div>}</div>
        {task && <div className="card p-5 space-y-4 self-start">
          <div className="flex items-start gap-3"><div className="flex-1"><h2 className="text-lg font-bold">{task.title}</h2><div className="text-sm text-muted">{task.employee_name}{task.position_name && ` · ${task.position_name}`}</div></div><StatusBadge status={task.status} label={LABEL[task.status]} /></div>
          {task.description && <p className="text-sm whitespace-pre-wrap">{task.description}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {task.photo_url && <div><div className="label">{tr("Фото задания")}</div><img src={task.photo_url} className="rounded-xl max-h-60 object-cover" /></div>}
            {task.result_photo_url && <div><div className="label">{tr("Фото результата")}</div><img src={task.result_photo_url} className="rounded-xl max-h-60 object-cover" /></div>}
          </div>
          {task.result_text && <div><div className="label">{tr("Результат сотрудника")}</div><div className="rounded-xl bg-elevated p-3 text-sm whitespace-pre-wrap">{task.result_text}</div></div>}
          <div className="text-xs text-muted space-y-0.5">
            <div>{tr("Создано:")} {fmtDateTime(task.created_at)} · {task.created_by}</div>{task.accepted_at && <div>{tr("Принято:")} {fmtDateTime(task.accepted_at)}</div>}{task.completed_at && <div>{tr("Выполнено:")} {fmtDateTime(task.completed_at)}</div>}{task.reviewed_at && <div>{tr("Проверено:")} {fmtDateTime(task.reviewed_at)} · {task.reviewed_by}</div>}
          </div>
          {canEdit && <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
            {(task.status === 'review' || task.status === 'accepted' || task.status === 'pending') && <><button className="btn-primary" onClick={() => review.mutate({ id: task.id, decision: 'approved' })} disabled={review.isPending}><Check className="h-4 w-4" />{tr("Подтвердить")}{+task.bonus_amount > 0 && ` · ${money(task.bonus_amount)}`}</button><button className="btn-danger" onClick={() => review.mutate({ id: task.id, decision: 'rejected' })} disabled={review.isPending}><X className="h-4 w-4" />{tr("Отклонить")}</button></>}
            {role === 'admin' && <button className="btn-ghost ml-auto text-danger" onClick={() => setDel(task.id)}><Trash2 className="h-4 w-4" />{tr("Удалить задачу")}</button>}
          </div>}
        </div>}
      </div>
      {create && <TaskForm onClose={() => setCreate(false)} />}
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить задачу?")} danger loading={remove.isPending} />
    </div>
  )
}

function TaskForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [emp, setEmp] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [bonus, setBonus] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const employees = useQuery({ queryKey: ['employees-all'], queryFn: async () => (await api.get('/employees?per_page=500&status=active')).data.items as { id: number; full_name: string; position_name: string | null; telegram_chat_id: string | null }[] })
  const m = useMutation({ mutationFn: async () => { const fd = new FormData(); fd.append('employee_id', String(emp)); fd.append('title', title); fd.append('description', desc); fd.append('bonus_amount', bonus || '0'); if (photo) fd.append('photo', photo); return api.post('/tasks', fd) }, onSuccess: () => { toast.push(tr("Задача отправлена")); qc.invalidateQueries(); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const chosen = employees.data?.find((e) => e.id === emp)
  return (
    <Modal open onClose={onClose} title={tr("Новая задача")} subtitle={tr("Отправится сотруднику в Telegram")} size="sm" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!emp || !title.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Отправить")}</button></>}>
      <div className="space-y-3">
        <Field label={tr("Сотрудник")} hint={chosen && !chosen.telegram_chat_id ? tr("⚠️ У сотрудника не подключён Telegram — задача останется только в системе") : undefined}><Select value={emp} onChange={setEmp} placeholder={tr("Выберите сотрудника...")} options={(employees.data ?? []).map((e) => ({ value: e.id, label: e.full_name, hint: e.position_name ?? undefined }))} /></Field>
        <Field label={tr("Название")}><input className="input" placeholder={tr("Например: Разнести товар на склад")} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={tr("Описание")}><textarea className="input" rows={3} placeholder={tr("Что нужно сделать")} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label={tr("Сумма бонуса")}><MoneyInput value={bonus} onChange={setBonus} /></Field>
        <Field label={tr("Фото задания")}><input type="file" accept="image/*" className="input" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Modal>
  )
}
