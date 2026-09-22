import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { Download, Pencil, Plus, Search, Send, Trash2, Upload, Palmtree, UserCheck, UserMinus, UserX, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '@/api/client'
import { Avatar, Confirm, Empty, Kpi, Pagination, Select, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui'
import { money, rateSuffix } from '@/lib/format'
import { useAuth } from '@/store/auth'
import { EmployeeDrawer } from './EmployeeDrawer'
import { EmployeeForm } from './EmployeeForm'
import { StructurePage } from './Structure'

type Emp = { id: number; full_name: string; employee_number: string; avatar_url: string | null; telegram_username: string | null; position_name: string | null; department_name: string | null; schedule_label: string | null; phone: string; status: string; current_rate: { rate_type: string; amount: string } | null }

export function EmployeesPage() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [section, setSection] = useState<'list' | 'structure'>(params.get('tab') === 'structure' ? 'structure' : 'list')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<string>('active')
  const [dep, setDep] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [open, setOpen] = useState<number | null>(params.get('open') ? Number(params.get('open')) : null)
  const [form, setForm] = useState<null | { id?: number }>(null)
  const [del, setDel] = useState<Emp | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(h) }, [q])
  useEffect(() => { if (open === null && params.get('open')) { params.delete('open'); setParams(params) } }, [open])

  const stats = useQuery({ queryKey: ['employee-stats'], queryFn: async () => (await api.get('/employees/stats')).data })
  const deps = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as { id: number; name: string }[] })
  const list = useQuery({ queryKey: ['employees', debounced, status, dep, page, perPage], queryFn: async () => (await api.get('/employees', { params: { q: debounced || undefined, status, department_id: dep ?? undefined, page, per_page: perPage } })).data as { items: Emp[]; total: number } })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/employees/${id}`), onSuccess: () => { toast.push(tr("Сотрудник удалён")); qc.invalidateQueries(); setDel(null) }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const importCsv = useMutation({ mutationFn: async (file: File) => { const fd = new FormData(); fd.append('file', file); return (await api.post('/employees/import', fd)).data }, onSuccess: (d) => { toast.push(tr("Импорт: создано {{v0}}, пропущено {{v1}}", { v0: d.created, v1: d.skipped })); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const canEdit = role === 'admin' || role === 'hr'
  const s = stats.data
  const pctOf = (n: number) => (s?.total ? `${Math.round((n / s.total) * 1000) / 10}%` : '0%')

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">{t('nav.employees')}</h1><Tabs className="mt-2" value={section} onChange={setSection} items={[{ value: 'list', label: tr("Список") }, { value: 'structure', label: tr("Подразделения и должности") }]} /></div>
        {canEdit && section === 'list' && <div className="flex gap-2">
          <a className="btn-secondary" href="/api/employees/export/csv" onClick={async (e) => { e.preventDefault(); const r = await api.get('/employees/export/csv', { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = 'employees.csv'; a.click() }}><Download className="h-4 w-4" />CSV</a>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />{tr("Импорт")}</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv.mutate(e.target.files[0])} />
          <button className="btn-primary" onClick={() => setForm({})}><Plus className="h-4 w-4" />{tr("Добавить")}</button>
        </div>}
      </div>
      {section === 'structure' ? <StructurePage embedded /> : <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi label={tr("Всего сотрудников")} icon={<Users />} value={s?.total ?? '…'} sub="100%" onClick={() => setStatus('all')} active={status === 'all'} />
        <Kpi label={tr("Активные")} icon={<UserCheck />} value={s?.active ?? '…'} sub={pctOf(s?.active ?? 0)} tone="success" onClick={() => setStatus('active')} active={status === 'active'} />
        <Kpi label={tr("В отпуске")} icon={<Palmtree />} value={s?.on_leave ?? '…'} sub={pctOf(s?.on_leave ?? 0)} tone="warning" onClick={() => setStatus('leave')} active={status === 'leave'} />
        <Kpi label={tr("Уволенные")} icon={<UserX />} value={s?.dismissed ?? '…'} sub={pctOf(s?.dismissed ?? 0)} tone="danger" onClick={() => setStatus('dismissed')} active={status === 'dismissed'} />
      </div>
      <div className="card">
        <div className="p-3 flex flex-wrap gap-2 border-b border-line">
          <div className="relative flex-1 min-w-56"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9" placeholder={tr("Поиск по имени, должности или телефону...")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /></div>
          <Select className="w-52" value={dep} onChange={(v) => { setDep(v); setPage(1) }} options={[{ value: null, label: tr("Все подразделения") }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
          <Select className="w-40" value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: 'all', label: tr("Все") }, { value: 'active', label: tr("Активный") }, { value: 'leave', label: tr("В отпуске") }, { value: 'dismissed', label: tr("Уволен") }]} />
        </div>
        <div className="overflow-x-auto">
          <table className="table"><thead><tr><th>{tr("Сотрудник")}</th><th>{tr("Должность")}</th><th>{tr("Подразделение")}</th><th>{tr("График")}</th><th>{tr("Телефон")}</th><th>{tr("Статус")}</th><th className="text-right">{tr("Зарплата")}</th>{canEdit && <th />}</tr></thead><tbody>
            {(list.data?.items ?? []).map((e) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => setOpen(e.id)}>
                <td><div className="flex items-center gap-2.5"><Avatar name={e.full_name} src={e.avatar_url} size={34} /><div><div className="font-medium">{e.full_name}</div><div className="flex items-center gap-1.5 text-xs text-muted">ID: {e.employee_number}{e.telegram_username && <Send className="h-3 w-3 text-accent" aria-label={`@${e.telegram_username}`} />}</div></div></div></td>
                <td>{e.position_name ?? '—'}</td><td>{e.department_name ?? '—'}</td><td className="text-xs text-muted max-w-40">{e.schedule_label}</td><td className="tabular-nums whitespace-nowrap">{e.phone || '—'}</td>
                <td><StatusBadge status={e.status} label={t(`status.${e.status}`)} /></td>
                <td className="text-right font-medium tabular-nums whitespace-nowrap">{e.current_rate ? tr("{{v0}}{{v1}}", { v0: money(e.current_rate.amount), v1: rateSuffix(e.current_rate.rate_type) }) : '—'}</td>
                {canEdit && <td className="text-right whitespace-nowrap"><button className="btn-ghost btn-sm" title={tr("Редактировать")} onClick={(ev) => { ev.stopPropagation(); setForm({ id: e.id }) }}><Pencil className="h-4 w-4" /></button>{role === 'admin' && <button className="btn-ghost btn-sm text-danger" title={tr("Удалить")} onClick={(ev) => { ev.stopPropagation(); setDel(e) }}><Trash2 className="h-4 w-4" /></button>}</td>}
              </tr>
            ))}
          </tbody></table>
        </div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length && <Empty text={tr("Сотрудники не найдены")} />}
        <Pagination page={page} perPage={perPage} total={list.data?.total ?? 0} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1) }} />
      </div>
      </>}
      {open && <EmployeeDrawer employeeId={open} onClose={() => setOpen(null)} />}
      {form && <EmployeeForm employeeId={form.id} onClose={() => setForm(null)} onSaved={() => setForm(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} title={tr("Удалить {{v0}}?", { v0: del?.full_name })} text={tr("Сотрудник будет помечен как удалённый; проходы и история сохранятся.")} danger loading={remove.isPending} />
    </div>
  )
}
