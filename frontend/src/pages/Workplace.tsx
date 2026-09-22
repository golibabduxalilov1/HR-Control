import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import axios from 'axios'
import { clsx } from 'clsx'
import { Building2, Loader2, LogOut, Plus, Shield } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '@/api/client'
import { Field, Modal, Select, Spinner, Toggle, ToastProvider, useToast } from '@/components/ui'
import { fmtDateTime } from '@/lib/format'

const papi = axios.create({ baseURL: '/api' })
papi.interceptors.request.use((c) => { const t = localStorage.getItem('platform-token'); if (t) c.headers.Authorization = `Bearer ${t}`; return c })

type Project = { id: number; slug: string; name: string; timezone: string; language: string; is_active: boolean; created_at: string; employee_count: number; license: { plan_name: string; billing_mode: string; valid_until: string | null; max_employees: number; max_devices: number; max_branches: number; access_blocked: boolean; block_reason: string; amount: string; amount_paid: string } | null }

export function WorkplacePage() {
  const [token, setToken] = useState(localStorage.getItem('platform-token'))
  if (!token) return <PlatformLogin onLogin={(t) => { localStorage.setItem('platform-token', t); setToken(t) }} />
  return <ToastProvider><Panel onLogout={() => { localStorage.removeItem('platform-token'); setToken(null) }} /></ToastProvider>
}

function PlatformLogin({ onLogin }: { onLogin: (t: string) => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false)
  const submit = async (e: FormEvent) => { e.preventDefault(); setLoading(true); setErr(''); try { const { data } = await papi.post('/workplace/login', { username: u, password: p }); onLogin(data.access_token) } catch (x) { setErr(errorMessage(x)) } finally { setLoading(false) } }
  return <div className="min-h-full flex items-center justify-center p-4"><form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-4"><div className="flex items-center gap-3"><div className="h-11 w-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center"><Shield className="h-5 w-5" /></div><div><div className="font-bold text-lg">Workplace</div><div className="text-xs text-muted">{tr("Панель платформы")}</div></div></div>
    <Field label={tr("Логин")}><input className="input" value={u} onChange={(e) => setU(e.target.value)} autoFocus /></Field><Field label={tr("Пароль")}><input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} /></Field>{err && <div className="text-sm text-danger">{err}</div>}<button className="btn-primary w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Войти")}</button></form></div>
}

function Panel({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [create, setCreate] = useState(false)
  const [edit, setEdit] = useState<Project | null>(null)
  const [ann, setAnn] = useState('')
  const q = useQuery({ queryKey: ['wp-projects'], queryFn: async () => (await papi.get('/workplace/projects')).data as Project[], retry: false })
  const announcement = useQuery({ queryKey: ['wp-ann'], queryFn: async () => (await papi.get('/workplace/announcement')).data })
  const saveAnn = useMutation({ mutationFn: async () => papi.put('/workplace/announcement', { text: ann, level: 'info' }), onSuccess: () => { toast.push(tr("Объявление сохранено")); qc.invalidateQueries({ queryKey: ['wp-ann'] }) } })
  if (q.error && axios.isAxiosError(q.error) && q.error.response?.status === 401) { onLogout(); return null }
  return (
    <div className="min-h-full p-4 lg:p-8 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" />{tr("Workplace · панель платформы")}</h1><p className="text-sm text-muted">{tr("Компании (тенанты), лицензии, объявления")}</p></div><div className="flex gap-2"><button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" />{tr("Новая компания")}</button><button className="btn-danger" onClick={onLogout}><LogOut className="h-4 w-4" />{tr("Выход")}</button></div></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[[tr("Компаний"), q.data?.length ?? 0], [tr("Активных"), q.data?.filter((p) => p.is_active).length ?? 0], [tr("Сотрудников всего"), q.data?.reduce((a, b) => a + b.employee_count, 0) ?? 0], [tr("Тестовых"), q.data?.filter((p) => p.license?.billing_mode === 'test').length ?? 0]].map(([l, v]) => <div key={String(l)} className="card p-4"><div className="text-xs text-muted">{l}</div><div className="text-2xl font-bold">{v}</div></div>)}</div>
      <div className="card overflow-hidden">{q.isLoading ? <Spinner /> : <table className="table"><thead><tr><th>{tr("Компания")}</th><th>URL</th><th>{tr("Тариф")}</th><th>{tr("Сотрудники")}</th><th>{tr("До")}</th><th>{tr("Статус")}</th><th /></tr></thead><tbody>
        {(q.data ?? []).map((p) => <tr key={p.id}><td><div className="font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-muted" />{p.name}</div><div className="text-xs text-muted">{p.timezone} · {p.language}</div></td><td><a className="text-accent font-mono text-sm" href={`/${p.slug}`} target="_blank" rel="noreferrer">/{p.slug}</a></td><td>{p.license?.plan_name ?? '—'} <span className="text-xs text-muted">({p.license?.billing_mode})</span></td><td>{p.employee_count} / {p.license?.max_employees ?? '—'}</td><td className="text-xs">{p.license?.valid_until ? fmtDateTime(p.license.valid_until) : '—'}</td><td>{!p.is_active ? <span className="badge-gray">{tr("выключен")}</span> : p.license?.access_blocked ? <span className="badge-red">{tr("заблокирован")}</span> : <span className="badge-green">{tr("активен")}</span>}</td><td className="text-right"><button className="btn-secondary btn-sm" onClick={() => setEdit(p)}>{tr("Управлять")}</button></td></tr>)}
      </tbody></table>}</div>
      <div className="card p-4 space-y-2"><div className="font-semibold">{tr("Объявление для всех кабинетов")}</div><div className="text-xs text-muted">{tr("Текущее:")} {announcement.data?.text || '—'}</div><div className="flex gap-2"><input className="input" value={ann} onChange={(e) => setAnn(e.target.value)} placeholder={tr("Текст объявления (пусто — снять)")} /><button className="btn-primary" onClick={() => saveAnn.mutate()}>{tr("Сохранить")}</button></div></div>
      {create && <ProjectForm onClose={() => setCreate(false)} />}
      {edit && <ProjectEdit p={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function ProjectForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast()
  const [f, setF] = useState({ slug: '', name: '', admin_username: 'admin', admin_password: '', timezone: 'Asia/Tashkent', language: 'ru', plan_name: tr("Тест"), max_employees: 50, max_devices: 1, max_branches: 1 })
  const m = useMutation({ mutationFn: async () => papi.post('/workplace/projects', f), onSuccess: () => { toast.push(tr("Компания создана")); qc.invalidateQueries({ queryKey: ['wp-projects'] }); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }))
  return <Modal open onClose={onClose} title={tr("Новая компания")} size="md" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!f.slug || !f.name || f.admin_password.length < 4 || m.isPending} onClick={() => m.mutate()}>{tr("Создать")}</button></>}>
    <div className="grid sm:grid-cols-2 gap-3"><Field label="Slug (URL)" hint={tr("Кабинет: {{v0}}/{{v1}}", { v0: location.origin, v1: f.slug || '…' })}><input className="input" value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></Field><Field label={tr("Название")}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label={tr("Логин админа")}><input className="input" value={f.admin_username} onChange={(e) => set('admin_username', e.target.value)} /></Field><Field label={tr("Пароль админа")}><input className="input" value={f.admin_password} onChange={(e) => set('admin_password', e.target.value)} /></Field><Field label={tr("Тариф")}><input className="input" value={f.plan_name} onChange={(e) => set('plan_name', e.target.value)} /></Field><Field label={tr("Язык")}><Select value={f.language} onChange={(v) => set('language', v)} options={[{ value: 'ru', label: tr("Русский") }, { value: 'uz', label: "O'zbek" }]} /></Field>{[['max_employees', tr("Макс. сотрудников")], ['max_devices', tr("Макс. устройств")], ['max_branches', tr("Макс. филиалов")]].map(([k, l]) => <Field key={k} label={l}><input type="number" className="input" value={(f as never)[k]} onChange={(e) => set(k, +e.target.value)} /></Field>)}</div></Modal>
}

function ProjectEdit({ p, onClose }: { p: Project; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast()
  const [f, setF] = useState({ name: p.name, is_active: p.is_active, plan_name: p.license?.plan_name ?? tr("Тест"), billing_mode: p.license?.billing_mode ?? 'test', valid_until: p.license?.valid_until?.slice(0, 10) ?? '', max_employees: p.license?.max_employees ?? 50, max_devices: p.license?.max_devices ?? 1, max_branches: p.license?.max_branches ?? 1, access_blocked: p.license?.access_blocked ?? false, block_reason: p.license?.block_reason ?? '', amount: p.license?.amount ?? 0, amount_paid: p.license?.amount_paid ?? 0, reset_admin_password: '' })
  const m = useMutation({ mutationFn: async () => papi.patch(`/workplace/projects/${p.id}`, { ...f, valid_until: f.valid_until ? `${f.valid_until}T23:59:59+00:00` : null, reset_admin_password: f.reset_admin_password || undefined }), onSuccess: () => { toast.push(tr("Сохранено")); qc.invalidateQueries({ queryKey: ['wp-projects'] }); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }))
  return <Modal open onClose={onClose} title={`${p.name} · /${p.slug}`} size="md" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>{tr("Сохранить")}</button></>}>
    <div className="space-y-4"><div className="grid sm:grid-cols-2 gap-3"><Field label={tr("Название")}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label={tr("Тариф")}><input className="input" value={f.plan_name} onChange={(e) => set('plan_name', e.target.value)} /></Field><Field label={tr("Режим")}><Select value={f.billing_mode} onChange={(v) => set('billing_mode', v)} options={[{ value: 'test', label: tr("Тест") }, { value: 'paid', label: tr("Оплачен") }]} /></Field><Field label={tr("Действует до")}><input type="date" className="input" value={f.valid_until} onChange={(e) => set('valid_until', e.target.value)} /></Field>{[['max_employees', tr("Макс. сотрудников")], ['max_devices', tr("Макс. устройств")], ['max_branches', tr("Макс. филиалов")], ['amount', tr("Сумма")], ['amount_paid', tr("Оплачено")]].map(([k, l]) => <Field key={k} label={l}><input type="number" className="input" value={(f as never)[k]} onChange={(e) => set(k, +e.target.value)} /></Field>)}<Field label={tr("Новый пароль админа")} hint={tr("Оставьте пустым, чтобы не менять")}><input className="input" value={f.reset_admin_password} onChange={(e) => set('reset_admin_password', e.target.value)} /></Field></div>
      <Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label={tr("Компания активна")} /><Toggle checked={f.access_blocked} onChange={(v) => set('access_blocked', v)} label={tr("Заблокировать доступ (неоплата)")} />{f.access_blocked && <Field label={tr("Причина блокировки")}><input className="input" value={f.block_reason} onChange={(e) => set('block_reason', e.target.value)} /></Field>}</div></Modal>
}
