import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { Bot, Building2, Check, Copy, FileText, KeyRound, Loader2, Plus, RefreshCw, Search, Shield, Sliders, Smartphone, Trash2, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorMessage } from '@/api/client'
import { Confirm, Empty, Field, Modal, MoneyInput, Select, Spinner, Tabs, Toggle, useToast } from '@/components/ui'
import { fmtDateTime, money } from '@/lib/format'
import { useAuth, useUi } from '@/store/auth'
import { BRAND_PRESETS, applyBrandColor, isHex } from '@/lib/brand'

type S = Record<string, any>
const THEMES = [['arctic', tr("Арктика"), tr("Светлый профессиональный")], ['daybreak', tr("Рассвет"), tr("Тёплый светлый")], ['pearl', tr("Жемчуг"), tr("Холодный минимализм")], ['mint', tr("Мята"), tr("Свежая мята")], ['sky', tr("Небо"), tr("Голубое небо")], ['meadow', tr("Луг"), tr("Зелёный луг")], ['lilac', tr("Сирень"), tr("Нежная сирень")], ['rose', tr("Роза"), tr("Нежная роза")]]

function useSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data as { company_name: string; inn: string; address: string; phone: string; email: string; timezone: string; language: string; last_password_change: string | null; settings: S } })
  const save = useMutation({ mutationFn: async (body: S) => (await api.put('/settings', body)).data, onSuccess: () => { toast.push(tr("Настройки сохранены")); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['license'] }) }, onError: (e) => toast.push(errorMessage(e), 'error') })
  return { q, save, s: q.data?.settings ?? {}, patch: (settings: S, top: S = {}) => save.mutate({ ...top, settings }) }
}

const Section = ({ title, sub, children, right }: { title: ReactNode; sub?: ReactNode; children: ReactNode; right?: ReactNode }) => (
  <div className="card p-5 space-y-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{title}</h2>{sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}</div>{right}</div>{children}</div>
)

export function SettingsPage() {
  const { role } = useAuth()
  const [tab, setTab] = useState('general')
  if (role !== 'admin') return <div className="card p-8"><Empty text={tr("Настройки доступны только администратору")} icon={<Shield className="h-8 w-8" />} /></div>
  const tabs = [['general', tr("Основные"), Sliders], ['branches', tr("Филиалы"), Building2], ['worktime', tr("Рабочее время"), Sliders], ['devices', tr("Устройства"), Smartphone], ['security', tr("Безопасность"), Shield], ['integrations', tr("Интеграции"), Bot], ['log', tr("Журнал"), FileText], ['license', tr("Лицензия"), KeyRound]] as const
  return (
    <div className="space-y-4 animate-fade-in">
      <div><h1 className="text-lg font-semibold">{tr("Настройки")}</h1></div>
      <div className="flex gap-1 overflow-x-auto pb-1">{tabs.map(([v, l, Icon]) => <button key={v} onClick={() => setTab(v)} className={clsx('btn whitespace-nowrap', tab === v ? 'bg-accent text-white' : 'bg-card border border-line text-muted hover:text-ink')}><Icon className="h-4 w-4" />{l}</button>)}</div>
      {tab === 'general' && <General />}{tab === 'branches' && <Branches />}{tab === 'worktime' && <WorkTime />}{tab === 'devices' && <Devices />}{tab === 'security' && <Security />}{tab === 'integrations' && <Integrations />}{tab === 'log' && <ActivityLog />}{tab === 'license' && <LicenseTab />}
    </div>
  )
}

/* ---------------------------------------------------------------- General */

function General() {
  const { i18n } = useTranslation()
  const { q, s, patch, save } = useSettings()
  const { setTheme, setMode } = useUi()
  const [form, setForm] = useState<S>({})
  const [company, setCompany] = useState<S>({})
  useEffect(() => { if (q.data) { setForm(q.data.settings); setCompany({ company_name: q.data.company_name, inn: q.data.inn, address: q.data.address, phone: q.data.phone, email: q.data.email, timezone: q.data.timezone }) } }, [q.data])
  if (q.isLoading) return <Spinner />
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  const onSave = () => { patch(form, company); setTheme(form.site_theme); setMode(form.theme_mode); applyBrandColor(form.brand_color); if (form.language !== i18n.language) { i18n.changeLanguage(form.language); localStorage.setItem('faceid-lang', form.language) } }
  return (
    <div className="space-y-4">
      <Section title={tr("Компания")}>
        <div className="grid sm:grid-cols-2 gap-3">
          {[['company_name', tr("Название")], ['inn', tr("ИНН")], ['phone', tr("Телефон")], ['email', 'Email'], ['address', tr("Адрес")]].map(([k, l]) => <Field key={k} label={l} className={k === 'address' ? 'sm:col-span-2' : ''}><input className="input" value={company[k] ?? ''} onChange={(e) => setCompany({ ...company, [k]: e.target.value })} /></Field>)}
        </div>
      </Section>
      <Section title={tr("Модули")}>
        <div className="space-y-3">
          <Toggle checked={!!form.finance_enabled} onChange={(v) => set('finance_enabled', v)} label={tr("Включить финансовый модуль")} hint={tr("Если выключено — скрываются расчёты, зарплата, бонусы и штрафы. Остаётся только учёт прихода, ухода и отработанных часов.")} />
          <Toggle checked={!!form.tasks_enabled} onChange={(v) => set('tasks_enabled', v)} label={tr("Включить модуль задач")} hint={tr("В меню появляется «Задачи»: отправка заданий сотрудникам в Telegram, проверка результата и начисление бонуса.")} />
          <Toggle checked={!!form.auto_accrue_on_checkout} onChange={(v) => set('auto_accrue_on_checkout', v)} label={tr("Автоначисление зарплаты при уходе")} hint={tr("При Face ID выходе зарплата за месяц пересчитывается автоматически. Иначе — вручную кнопкой «Начислить зарплату».")} />
          <Toggle checked={!!form.show_payday} onChange={(v) => set('show_payday', v)} label={tr("Показывать дату выплаты зарплаты")} hint={tr("В списке сотрудников отображается, когда наступает день выплаты.")} />
        </div>
      </Section>
      <Section title={tr("Локализация и отображение")}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={tr("Язык системы")}><Select value={form.language ?? 'ru'} onChange={(v) => set('language', v)} options={[{ value: 'ru', label: tr("Русский") }, { value: 'uz', label: "O'zbek" }]} /></Field>
          <Field label={tr("Формат даты")}><Select value={form.date_format ?? 'dd.mm.yyyy'} onChange={(v) => set('date_format', v)} options={[{ value: 'dd.mm.yyyy', label: tr("ДД.ММ.ГГГГ") }, { value: 'yyyy-mm-dd', label: tr("ГГГГ-ММ-ДД") }]} /></Field>
          <Field label={tr("Формат времени")}><Select value={form.time_format ?? '24h'} onChange={(v) => set('time_format', v)} options={[{ value: '24h', label: tr("24 часа") }, { value: '12h', label: tr("12 часов") }]} /></Field>
          <Field label={tr("Часовой пояс")}><Select value={company.timezone ?? 'Asia/Tashkent'} onChange={(v) => setCompany({ ...company, timezone: v })} options={['Asia/Tashkent', 'Asia/Almaty', 'Asia/Dushanbe', 'Asia/Bishkek', 'Europe/Moscow', 'Asia/Dubai'].map((z) => ({ value: z, label: z }))} /></Field>
          <Field label={tr("Валюта")}><Select value={form.currency ?? 'UZS'} onChange={(v) => set('currency', v)} options={[{ value: 'UZS', label: tr("UZS (сум)") }, { value: 'USD', label: 'USD' }, { value: 'RUB', label: 'RUB' }, { value: 'KZT', label: 'KZT' }]} /></Field>
          <Field label={tr("Первый день недели")}><Select value={form.week_start ?? 'monday'} onChange={(v) => set('week_start', v)} options={[{ value: 'monday', label: tr("Понедельник") }, { value: 'sunday', label: tr("Воскресенье") }]} /></Field>
          <Field label={tr("Вид главной страницы")}><Select value={form.dashboard_view ?? 'attendance'} onChange={(v) => set('dashboard_view', v)} options={[{ value: 'attendance', label: tr("Посещаемость") }, { value: 'finance', label: tr("Финансы") }]} /></Field>
          <Field label={tr("Режим")}><Select value={form.theme_mode ?? 'light'} onChange={(v) => set('theme_mode', v)} options={[{ value: 'light', label: tr("Светлый") }, { value: 'dark', label: tr("Тёмный") }]} /></Field>
        </div>
        <div><div className="label">{tr("Фирменный цвет")}</div>
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_PRESETS.map((p) => <button key={p.hex} type="button" title={p.name} onClick={() => { set('brand_color', p.hex); applyBrandColor(p.hex) }} className={clsx('h-8 w-8 rounded-full transition ring-offset-2 ring-offset-card', form.brand_color === p.hex ? 'ring-2 ring-ink' : 'hover:scale-110')} style={{ background: p.hex }} />)}
            <label className="relative h-8 w-8 rounded-full border border-line overflow-hidden cursor-pointer" title={tr("Свой цвет")} style={{ background: 'conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}><input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={isHex(form.brand_color || '') ? form.brand_color : '#2f5bea'} onChange={(e) => { set('brand_color', e.target.value); applyBrandColor(e.target.value) }} /></label>
            <input className="input !w-32 font-mono" placeholder="#2f5bea" value={form.brand_color ?? ''} onChange={(e) => { set('brand_color', e.target.value); if (isHex(e.target.value)) applyBrandColor(e.target.value) }} />
            {form.brand_color && <button type="button" className="btn-ghost btn-sm" onClick={() => { set('brand_color', ''); applyBrandColor(null) }}>{tr("Сбросить")}</button>}
            <span className="btn-primary btn-sm pointer-events-none">{tr("Пример кнопки")}</span>
          </div>
          <div className="text-xs text-muted mt-1.5">{tr("Цвет кнопок, активных пунктов меню, ссылок и графиков. Применяется ко всем пользователям компании, включая страницу входа.")}</div>
        </div>
        <div><div className="label">{tr("Тема оформления")}</div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{THEMES.map(([v, l, d]) => <button key={v} type="button" onClick={() => { set('site_theme', v); setTheme(v) }} className={clsx('rounded-xl border p-3 text-left transition cursor-pointer', form.site_theme === v ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/40')}><div className="font-medium text-sm">{l}</div><div className="text-xs text-muted">{d}</div></button>)}</div></div>
      </Section>
      <StatusEditor title={tr("Статусы сотрудников")} sub={tr("Статусы в карточке сотрудника. Системные можно переименовать; свои — добавить.")} items={form.employment_statuses ?? []} onChange={(v) => set('employment_statuses', v)} />
      <div className="flex justify-end"><button className="btn-primary" onClick={onSave} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Сохранить настройки")}</button></div>
    </div>
  )
}

function StatusEditor({ title, sub, items, onChange }: { title: string; sub: string; items: { id: string; label: string; builtin: boolean; enabled: boolean; sort_order: number }[]; onChange: (v: typeof items) => void }) {
  const [name, setName] = useState('')
  const move = (i: number, d: number) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a.map((x, k) => ({ ...x, sort_order: k }))) }
  return (
    <Section title={title} sub={sub}>
      <table className="table"><thead><tr><th>#</th><th>{tr("Название")}</th><th>{tr("Тип")}</th><th className="text-center">{tr("Показать")}</th><th /></tr></thead><tbody>
        {items.map((it, i) => <tr key={it.id}><td className="text-muted">{i + 1}</td><td><input className="input !py-1" value={it.label} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} /></td><td className="text-xs text-muted">{it.builtin ? tr("Системный") : tr("Свой")}</td><td className="text-center"><input type="checkbox" checked={it.enabled} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, enabled: e.target.checked } : x)))} /></td>
          <td className="text-right whitespace-nowrap"><button className="btn-ghost btn-sm" onClick={() => move(i, -1)}>↑</button><button className="btn-ghost btn-sm" onClick={() => move(i, 1)}>↓</button>{!it.builtin && <button className="btn-ghost btn-sm text-danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))}><Trash2 className="h-3.5 w-3.5" /></button>}</td></tr>)}
      </tbody></table>
      <div className="flex gap-2"><input className="input" placeholder={tr("Название")} value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-secondary" disabled={!name.trim()} onClick={() => { onChange([...items, { id: `custom_${Date.now()}`, label: name.trim(), builtin: false, enabled: true, sort_order: items.length }]); setName('') }}><Plus className="h-4 w-4" />{tr("Добавить")}</button></div>
    </Section>
  )
}

/* ---------------------------------------------------------------- Branches & users */

function Branches() {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [user, setUser] = useState({ username: '', password: '', display_name: '', role: 'operator', branch_id: null as number | null })
  const [del, setDel] = useState<{ kind: 'branch' | 'user'; id: number } | null>(null)
  const branches = useQuery({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data as { id: number; name: string; employee_count: number }[] })
  const users = useQuery({ queryKey: ['cabinet-users'], queryFn: async () => (await api.get('/cabinet-users')).data as { id: number; username: string; display_name: string; role: string; branch_name: string | null; is_active: boolean }[] })
  const inv = () => qc.invalidateQueries()
  const err = (e: unknown) => toast.push(errorMessage(e), 'error')
  const addBranch = useMutation({ mutationFn: async () => api.post('/branches', { name }), onSuccess: () => { setName(''); inv() }, onError: err })
  const addUser = useMutation({ mutationFn: async () => api.post('/cabinet-users', user), onSuccess: () => { toast.push(tr("Логин создан")); setUser({ username: '', password: '', display_name: '', role: 'operator', branch_id: null }); inv() }, onError: err })
  const remove = useMutation({ mutationFn: async (d: { kind: string; id: number }) => api.delete(`/${d.kind === 'branch' ? 'branches' : 'cabinet-users'}/${d.id}`), onSuccess: () => { setDel(null); inv() }, onError: err })
  const toggleUser = useMutation({ mutationFn: async (u: { id: number; is_active: boolean }) => api.patch(`/cabinet-users/${u.id}`, { is_active: !u.is_active }), onSuccess: inv })
  const { slug } = useAuth()
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-accent-soft text-sm p-3">{tr("Один URL — все филиалы входят по одному адресу (")}<b>/{slug}</b>{tr("). Создайте отдельный логин для каждого филиала — система покажет только его данные.")}</div>
      <Section title={tr("Филиалы")}>
        <table className="table"><thead><tr><th>{tr("Название")}</th><th className="text-center">{tr("Сотрудники")}</th><th /></tr></thead><tbody>{(branches.data ?? []).map((b) => <tr key={b.id}><td className="font-medium">{b.name}</td><td className="text-center">{b.employee_count}</td><td className="text-right"><button className="btn-ghost btn-sm text-danger" onClick={() => setDel({ kind: 'branch', id: b.id })}><Trash2 className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table>
        {!branches.data?.length && <Empty text={tr("Филиалов нет — все сотрудники в главном офисе")} />}
        <div className="flex gap-2"><input className="input" placeholder={tr("Новый филиал")} value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary whitespace-nowrap" disabled={!name.trim()} onClick={() => addBranch.mutate()}><Plus className="h-4 w-4" />{tr("Добавить филиал")}</button></div>
      </Section>
      <Section title={tr("Логины (один URL)")} sub={tr("{{v0}} пользоват.", { v0: users.data?.length ?? 0 })}>
        <div className="space-y-2">{(users.data ?? []).map((u) => <div key={u.id} className={clsx('flex items-center gap-3 rounded-xl border border-line p-3', !u.is_active && 'opacity-50')}><div className="h-9 w-9 rounded-xl bg-accent-soft text-accent font-bold flex items-center justify-center text-xs uppercase">{u.username.slice(0, 2)}</div><div className="flex-1 min-w-0"><div className="font-medium">{u.username} <span className="text-xs text-muted">· {u.display_name}</span></div><div className="text-xs text-muted">{u.branch_name ?? tr("Главный офис (все филиалы)")}</div></div><span className={u.role === 'admin' ? 'badge-blue' : 'badge-gray'}>{{ admin: 'Admin', operator: 'Operator', hr: 'HR', manager: 'Manager' }[u.role]}</span><button className="btn-ghost btn-sm" onClick={() => toggleUser.mutate(u)}>{u.is_active ? tr("Отключить") : tr("Включить")}</button><button className="btn-ghost btn-sm text-danger" onClick={() => setDel({ kind: 'user', id: u.id })}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
        <div className="rounded-xl border border-line p-3 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
          <Field label={tr("Логин")}><input className="input" value={user.username} onChange={(e) => setUser({ ...user, username: e.target.value })} /></Field>
          <Field label={tr("Пароль")}><input className="input" type="password" value={user.password} onChange={(e) => setUser({ ...user, password: e.target.value })} /></Field>
          <Field label={tr("Филиал")}><Select value={user.branch_id} onChange={(v) => setUser({ ...user, branch_id: v })} options={[{ value: null, label: tr("Главный офис (все филиалы)") }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} /></Field>
          <Field label={tr("Роль")}><Select value={user.role} onChange={(v) => setUser({ ...user, role: v })} options={[{ value: 'admin', label: 'Admin', hint: tr("Полный доступ") }, { value: 'hr', label: 'HR', hint: tr("Сотрудники, табель, заявки") }, { value: 'manager', label: 'Manager', hint: tr("Только просмотр") }, { value: 'operator', label: 'Operator', hint: tr("Только просмотр") }]} /></Field>
          <button className="btn-primary" disabled={user.username.length < 3 || user.password.length < 6} onClick={() => addUser.mutate()}>{tr("Создать логин")}</button>
        </div>
      </Section>
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить?")} danger />
    </div>
  )
}

/* ---------------------------------------------------------------- Work time */

function WorkTime() {
  const { q, s, patch, save } = useSettings()
  const [sub, setSub] = useState('general')
  const [f, setF] = useState<S>({})
  useEffect(() => { if (q.data) setF(q.data.settings) }, [q.data])
  if (q.isLoading) return <Spinner />
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const Save = <div className="flex justify-end"><button className="btn-primary" onClick={() => patch(f)} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Сохранить")}</button></div>
  const num = (k: string, label: string, hint?: string, suffix?: string) => <Field label={label} hint={hint}><div className="relative"><input type="number" className="input pr-12" value={f[k] ?? ''} onChange={(e) => set(k, +e.target.value)} />{suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}</div></Field>
  return (
    <div className="space-y-4">
      <Tabs value={sub} onChange={setSub} items={[{ value: 'general', label: tr("Общие") }, { value: 'fines', label: tr("Автоштрафы") }, { value: 'breaks', label: tr("Перерывы") }, { value: 'overtime', label: tr("Сверхурочные") }, { value: 'statuses', label: tr("Статусы табеля") }]} />
      {sub === 'general' && <Section title={tr("Общие")} sub={tr("Контроль начала смены, опозданий и раннего ухода (значения по умолчанию, графики их переопределяют)")}>
        <Field label={tr("Режим работы")}><div className="flex gap-1 rounded-xl bg-elevated p-1 w-fit">{[['fixed', tr("По графику")], ['flexible', tr("Гибкий")]].map(([v, l]) => <button key={v} className={clsx('tab', f.worktime_mode === v && 'tab-active')} onClick={() => set('worktime_mode', v)}>{l}</button>)}</div></Field>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={tr("Начало рабочего дня")}><input type="time" className="input" value={f.workday_start ?? '08:00'} onChange={(e) => set('workday_start', e.target.value)} /></Field>
          {num('late_grace_min', tr("Допуск на опоздание"), undefined, tr("мин"))}{num('min_work_hours', tr("Минимальное время работы"), undefined, tr("ч"))}
          <Field label={tr("Округление времени")}><Select value={f.time_rounding_min ?? 0} onChange={(v) => set('time_rounding_min', v)} options={[{ value: 0, label: tr("Нет") }, { value: 5, label: tr("До 5 мин") }, { value: 10, label: tr("До 10 мин") }, { value: 15, label: tr("До 15 мин") }, { value: 30, label: tr("До 30 мин") }]} /></Field>
          <Field label={tr("Закрытие рабочего дня")} hint={tr("До этого часа события после полуночи относятся к предыдущему дню (например, выход в 00:30 при 04:00 — к вчерашней смене).")}><Select value={f.day_close_hour ?? 6} onChange={(v) => set('day_close_hour', v)} options={[0, 2, 3, 4, 5, 6, 7, 8].map((h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))} /></Field>
          <Field label={tr("Подсчёт часов по умолчанию")}><Select value={f.hours_calc_default_mode ?? 'first_last'} onChange={(v) => set('hours_calc_default_mode', v)} options={[{ value: 'first_last', label: tr("Первый вход — последний выход") }, { value: 'sessions', label: tr("Сессии (сумма)") }]} /></Field>
        </div>
        <div className="space-y-3 pt-2"><Toggle checked={!!f.auto_late_calc} onChange={(v) => set('auto_late_calc', v)} label={tr("Автоматический расчёт опозданий")} /><Toggle checked={!!f.exit_watch_enabled} onChange={(v) => set('exit_watch_enabled', v)} label={tr("Контроль выходов в рабочее время (проблемные)")} /><Toggle checked={!!f.require_location} onChange={(v) => set('require_location', v)} label={tr("Требовать подтверждение локации")} hint={tr("Для отметок через Telegram")} /><Toggle checked={!!f.allow_telegram_checkin} onChange={(v) => set('allow_telegram_checkin', v)} label={tr("Разрешить отметки через Telegram всем")} hint={tr("По умолчанию — только сотрудникам с режимом «Удалённо» / «Гибрид»")} /><Toggle checked={!!f.auto_sync} onChange={(v) => set('auto_sync', v)} label={tr("Автоматическая синхронизация данных")} /></div>
        {Save}</Section>}
      {sub === 'fines' && <Section title={tr("Автоматические штрафы")} sub={tr("Штрафы создаются автоматически при опоздании, раннем уходе или отсутствии без уважительной причины. Принятая заявка «Уважительная причина» отменяет штраф за день.")}>
        <Toggle checked={!!f.auto_fines_enabled} onChange={(v) => set('auto_fines_enabled', v)} label={tr("Включить автоматические штрафы")} />
        <div className={clsx('space-y-4', !f.auto_fines_enabled && 'opacity-50 pointer-events-none')}>
          <Field label={tr("Штрафовать с даты")} hint={tr("До этой даты автоштрафы не начисляются, уже созданные за прошлые дни будут удалены.")}><input type="date" className="input !w-auto" value={f.auto_fines_from_date ?? ''} onChange={(e) => set('auto_fines_from_date', e.target.value || null)} /></Field>
          <div className="rounded-xl border border-line p-3 space-y-3"><Toggle checked={!!f.auto_fine_late_enabled} onChange={(v) => set('auto_fine_late_enabled', v)} label={tr("Штраф за опоздание")} />
            <div className="grid sm:grid-cols-3 gap-3"><Field label={tr("Сумма штрафа")}><MoneyInput value={String(f.auto_fine_late_amount ?? '')} onChange={(v) => set('auto_fine_late_amount', +v)} /></Field>
              <Field label={tr("Дополнительно за каждый час")}><div className="space-y-1"><Toggle checked={!!f.auto_fine_late_per_hour} onChange={(v) => set('auto_fine_late_per_hour', v)} label={tr("Включить")} />{f.auto_fine_late_per_hour && <MoneyInput value={String(f.auto_fine_late_per_hour_amount ?? '')} onChange={(v) => set('auto_fine_late_per_hour_amount', +v)} />}</div></Field>
              <Field label={tr("Дополнительно за каждую минуту")}><div className="space-y-1"><Toggle checked={!!f.auto_fine_late_per_minute} onChange={(v) => set('auto_fine_late_per_minute', v)} label={tr("Включить")} />{f.auto_fine_late_per_minute && <MoneyInput value={String(f.auto_fine_late_per_minute_amount ?? '')} onChange={(v) => set('auto_fine_late_per_minute_amount', +v)} />}</div></Field></div></div>
          <div className="rounded-xl border border-line p-3 grid sm:grid-cols-2 gap-3 items-end"><Toggle checked={!!f.auto_fine_early_enabled} onChange={(v) => set('auto_fine_early_enabled', v)} label={tr("Штраф за ранний уход")} /><MoneyInput value={String(f.auto_fine_early_amount ?? '')} onChange={(v) => set('auto_fine_early_amount', +v)} /></div>
          <div className="rounded-xl border border-line p-3 grid sm:grid-cols-2 gap-3 items-end"><Toggle checked={!!f.auto_fine_absent_enabled} onChange={(v) => set('auto_fine_absent_enabled', v)} label={tr("Штраф за отсутствие без причины")} hint={tr("Начисляется на следующий день после прогула")} /><MoneyInput value={String(f.auto_fine_absent_amount ?? '')} onChange={(v) => set('auto_fine_absent_amount', +v)} /></div>
        </div>{Save}</Section>}
      {sub === 'breaks' && <Section title={tr("Перерывы")}><div className="space-y-3"><Toggle checked={!!f.include_lunch} onChange={(v) => set('include_lunch', v)} label={tr("Учитывать обеденный перерыв в отработанное время")} hint={tr("Если выключено — время обеда по графику вычитается")} /><Toggle checked={!!f.flexible_include_lunch} onChange={(v) => set('flexible_include_lunch', v)} label={tr("Учитывать обед при гибком графике")} /><Toggle checked={!!f.lunch_tracking_enabled} onChange={(v) => set('lunch_tracking_enabled', v)} label={tr("Контроль выхода на обед (Face ID)")} /></div>
        <div className="grid sm:grid-cols-2 gap-3"><Field label={tr("Начало обеда (по умолчанию)")}><input type="time" className="input" value={f.lunch_start_default ?? '12:00'} onChange={(e) => set('lunch_start_default', e.target.value)} /></Field><Field label={tr("Конец обеда")}><input type="time" className="input" value={f.lunch_end_default ?? '13:00'} onChange={(e) => set('lunch_end_default', e.target.value)} /></Field></div>{Save}</Section>}
      {sub === 'overtime' && <Section title={tr("Сверхурочные")}><Toggle checked={!!f.allow_overtime} onChange={(v) => set('allow_overtime', v)} label={tr("Разрешить сверхурочные")} hint={tr("Учитываются по правилам графика (оплата вне графика)")} /><div className="grid sm:grid-cols-2 gap-3">{num('overtime_after_min', tr("Сверхурочные после"), undefined, tr("мин"))}{num('weekly_norm_hours', tr("Норма часов в неделю"), undefined, tr("ч"))}</div>{Save}</Section>}
      {sub === 'statuses' && <><StatusEditor title={tr("Статусы табеля")} sub={tr("Статусы для ручной правки табеля и заявок. Это не статусы сотрудника — они в разделе «Основные».")} items={f.attendance_day_statuses ?? []} onChange={(v) => set('attendance_day_statuses', v)} />{Save}</>}
    </div>
  )
}

/* ---------------------------------------------------------------- Devices */

function Devices() {
  const qc = useQueryClient()
  const toast = useToast()
  const [edit, setEdit] = useState<S | null>(null)
  const [del, setDel] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['devices'], queryFn: async () => (await api.get('/devices')).data as S[] })
  const live = useQuery({ queryKey: ['devices-live'], queryFn: async () => (await api.get('/devices/live-status')).data as { id: number; is_online: boolean; last_seen_at: string | null }[], refetchInterval: 30_000 })
  const license = useQuery({ queryKey: ['license'], queryFn: async () => (await api.get('/license')).data })
  const save = useMutation({ mutationFn: async (d: S) => (d.id ? api.put(`/devices/${d.id}`, d) : api.post('/devices', d)), onSuccess: () => { toast.push(tr("Сохранено")); setEdit(null); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/devices/${id}`), onSuccess: () => { setDel(null); qc.invalidateQueries() } })
  const status = (id: number) => live.data?.find((x) => x.id === id)
  return (
    <Section title={tr("Устройства Face ID")} sub={tr("Терминалы, подключённые через HikCentral. Настроено {{v0}} из {{v1}}", { v0: q.data?.length ?? 0, v1: license.data?.max_devices ?? '—' })} right={<button className="btn-primary" onClick={() => setEdit({ name: '', serial: '', password: '', direction: 'both', hik_device_id: '', hik_door_index: '' })}><Plus className="h-4 w-4" />{tr("Добавить")}</button>}>
      <div className="grid sm:grid-cols-2 gap-3">{(q.data ?? []).map((d) => { const st = status(d.id); return (
        <div key={d.id} className="rounded-xl border border-line p-3 space-y-1"><div className="flex items-center gap-2"><span className={clsx('h-8 w-8 rounded-lg flex items-center justify-center', st?.is_online ? 'bg-success/10 text-success' : 'bg-elevated text-muted')}>{st?.is_online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}</span><div className="flex-1"><div className="font-medium">{d.name}</div><div className="text-xs text-muted">{{ in: tr("Вход"), out: tr("Выход"), both: tr("Вход / Выход") }[d.direction as string]} · {st?.is_online ? 'ONLINE' : st?.last_seen_at ? tr("был {{v0}}", { v0: fmtDateTime(st.last_seen_at) }) : tr("нет событий")}</div></div><button className="btn-ghost btn-sm" onClick={() => setEdit({ ...d, password: '' })}>{tr("Изменить")}</button><button className="btn-ghost btn-sm text-danger" onClick={() => setDel(d.id)}><Trash2 className="h-3.5 w-3.5" /></button></div>
          <div className="text-xs text-muted">S/N: {d.serial || '—'} · Hik: {d.hik_device_id || '—'} {d.hik_door_index && tr("/ дверь {{v0}}", { v0: d.hik_door_index })}</div></div>) })}</div>
      {!q.data?.length && <Empty text={tr("Устройств нет")} icon={<Smartphone className="h-8 w-8" />} />}
      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? tr("Устройство") : tr("Новое устройство")} size="sm" footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>{tr("Отмена")}</button><button className="btn-primary" disabled={!edit.name} onClick={() => save.mutate(edit)}>{tr("Сохранить")}</button></>}>
        <div className="space-y-3"><Field label={tr("Название")}><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label={tr("Направление")}><Select value={edit.direction} onChange={(v) => setEdit({ ...edit, direction: v })} options={[{ value: 'both', label: tr("Вход / Выход (по событию)") }, { value: 'in', label: tr("Только вход") }, { value: 'out', label: tr("Только выход") }]} /></Field>
          <Field label={tr("Серийный номер")}><input className="input" value={edit.serial} onChange={(e) => setEdit({ ...edit, serial: e.target.value })} /></Field>
          <Field label={tr("Пароль устройства")}><input className="input" type="password" placeholder={edit.id ? tr("оставьте пустым, чтобы не менять") : ''} value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <Field label="HikCentral device index code" hint={tr("acsDevIndexCode из HikCentral — события этого устройства привяжутся сюда")}><input className="input" value={edit.hik_device_id ?? ''} onChange={(e) => setEdit({ ...edit, hik_device_id: e.target.value })} /></Field>
          <Field label="HikCentral door index code"><input className="input" value={edit.hik_door_index ?? ''} onChange={(e) => setEdit({ ...edit, hik_door_index: e.target.value })} /></Field></div></Modal>}
      <Confirm open={del !== null} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить устройство?")} danger />
    </Section>
  )
}

/* ---------------------------------------------------------------- Security */

function Security() {
  const toast = useToast()
  const { q } = useSettings()
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [rep, setRep] = useState('')
  const m = useMutation({ mutationFn: async () => api.post('/auth/change-password', { current_password: cur, new_password: nw }), onSuccess: () => { toast.push(tr("Пароль изменён")); setCur(''); setNw(''); setRep('') }, onError: (e) => toast.push(errorMessage(e), 'error') })
  return (
    <Section title={tr("Смена пароля")} sub={q.data?.last_password_change ? tr("Последняя смена: {{v0}}", { v0: fmtDateTime(q.data.last_password_change) }) : tr("Пароль ещё не менялся")}>
      <div className="grid sm:grid-cols-3 gap-3"><Field label={tr("Текущий пароль")}><input type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} /></Field><Field label={tr("Новый пароль")}><input type="password" className="input" value={nw} onChange={(e) => setNw(e.target.value)} /></Field><Field label={tr("Повторите")}><input type="password" className="input" value={rep} onChange={(e) => setRep(e.target.value)} /></Field></div>
      <button className="btn-primary" disabled={!cur || nw.length < 6 || nw !== rep} onClick={() => m.mutate()}>{tr("Изменить пароль")}</button>
    </Section>
  )
}

/* ---------------------------------------------------------------- Integrations */

function Integrations() {
  const { q, s, patch, save } = useSettings()
  const toast = useToast()
  const qc = useQueryClient()
  const [sub, setSub] = useState('bots')
  const [f, setF] = useState<S>({})
  const [tokens, setTokens] = useState({ telegram_bot_token: '', attendance_feed_bot_token: '', late_absent_bot_token: '', hik_app_secret: '' })
  useEffect(() => { if (q.data) setF(q.data.settings) }, [q.data])
  const bots = useQuery({ queryKey: ['tg-bots'], queryFn: async () => (await api.get('/integrations/telegram/bots')).data as Record<string, { configured: boolean; info: { username?: string; error?: string } | null; running: boolean }> })
  const employees = useQuery({ queryKey: ['employees-all'], queryFn: async () => (await api.get('/employees?per_page=500&status=active')).data.items as { id: number; full_name: string; telegram_username: string | null; telegram_chat_id: string | null; department_name: string | null }[] })
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: async () => (await api.get('/integrations/api-keys')).data as { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[] })
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyName, setKeyName] = useState('')
  if (q.isLoading) return <Spinner />
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const saveAll = async () => { const body: S = { ...f }; for (const [k, v] of Object.entries(tokens)) if (v) body[k] = v; await save.mutateAsync({ settings: body }); setTokens({ telegram_bot_token: '', attendance_feed_bot_token: '', late_absent_bot_token: '', hik_app_secret: '' }); await api.post('/integrations/telegram/restart').catch(() => {}); qc.invalidateQueries({ queryKey: ['tg-bots'] }) }
  const test = async (kind: string, tokenKey: keyof typeof tokens, chatIds: string[] = []) => { try { const { data } = await api.post('/integrations/telegram/test', { kind, token: tokens[tokenKey] || undefined, chat_ids: chatIds }); toast.push(`✅ @${data.username}${data.sent ? tr(" · отправлено {{v0}}", { v0: data.sent }) : ''}`) } catch (e) { toast.push(errorMessage(e), 'error') } }
  const testHik = async () => { try { const { data } = await api.post('/integrations/hikcentral/test'); toast.push(tr("HikCentral: устройств {{v0}}", { v0: data.device_count })) } catch (e) { toast.push(errorMessage(e), 'error') } }
  const syncHik = async () => { try { const { data } = await api.post('/integrations/hikcentral/sync-now'); toast.push(tr("Синхронизация: получено {{v0}}, пропущено {{v1}}", { v0: data.ingested, v1: data.skipped })) } catch (e) { toast.push(errorMessage(e), 'error') } }
  const createKey = async () => { const { data } = await api.post('/integrations/api-keys', { name: keyName || 'key' }); setNewKey(data.key); setKeyName(''); qc.invalidateQueries({ queryKey: ['api-keys'] }) }
  const Save = <div className="flex justify-end"><button className="btn-primary" onClick={saveAll} disabled={save.isPending}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Сохранить")}</button></div>
  const BotCard = ({ kind, tokenKey, title, desc, enabledKey, children }: { kind: string; tokenKey: keyof typeof tokens; title: string; desc: string; enabledKey?: string; children?: ReactNode }) => {
    const b = bots.data?.[kind]
    return <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-start gap-3"><div className="h-10 w-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center"><Bot className="h-5 w-5" /></div><div className="flex-1"><div className="font-semibold">{title}</div><div className="text-xs text-muted">{desc}</div></div>
        {b?.configured ? (b.info?.username ? <a className="badge-green" href={`https://t.me/${b.info.username}`} target="_blank" rel="noreferrer">@{b.info.username} · {b.running ? tr("работает") : tr("остановлен")}</a> : <span className="badge-red">{b.info?.error ?? tr("ошибка")}</span>) : <span className="badge-gray">{tr("не подключено")}</span>}</div>
      {enabledKey && <Toggle checked={!!f[enabledKey]} onChange={(v) => set(enabledKey, v)} label={tr("Включить {{v0}}", { v0: title.toLowerCase() })} />}
      <Field label={tr("Токен бота")} hint={s[`${tokenKey}_set`] ? tr("Токен сохранён. Вставьте новый, чтобы заменить.") : tr("Создайте бота в @BotFather и вставьте токен сюда.")}><div className="flex gap-2"><input className="input font-mono text-xs" type="password" placeholder={s[`${tokenKey}_set`] ? '••••••••••' : '123456:ABC-DEF...'} value={tokens[tokenKey]} onChange={(e) => setTokens({ ...tokens, [tokenKey]: e.target.value })} /><button className="btn-secondary whitespace-nowrap" onClick={() => test(kind, tokenKey)}>{tr("Проверить связь")}</button></div></Field>
      {children}
    </div>
  }
  const PeopleList = ({ keyIds, label, hint }: { keyIds: string; label: string; hint: string }) => {
    const sel: number[] = f[keyIds] ?? []
    return <div><div className="flex items-center justify-between mb-1"><div className="label !mb-0">{label} · {sel.length} {tr("выбрано")}</div><div className="flex gap-1"><button className="btn-ghost btn-sm" onClick={() => set(keyIds, (employees.data ?? []).filter((e) => e.telegram_chat_id).map((e) => e.id))}>{tr("Все с Telegram")}</button><button className="btn-ghost btn-sm" onClick={() => set(keyIds, [])}>{tr("Сбросить")}</button></div></div><div className="text-xs text-muted mb-2">{hint}</div>
      <div className="max-h-56 overflow-auto rounded-xl border border-line divide-y divide-line">{(employees.data ?? []).map((e) => <label key={e.id} className={clsx('flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer', !e.telegram_chat_id && 'opacity-50')}><input type="checkbox" checked={sel.includes(e.id)} onChange={(ev) => set(keyIds, ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))} /><span className="flex-1">{e.full_name}</span><span className="text-xs text-muted">{e.department_name ?? '—'} · {e.telegram_username ? `@${e.telegram_username}` : tr("нет TG")}</span></label>)}</div></div>
  }
  const ChatIds = ({ k, label }: { k: string; label: string }) => { const list: string[] = f[k] ?? []; const [v, setV] = useState(''); return <Field label={label}><div className="flex flex-wrap gap-1 mb-1">{list.map((c) => <span key={c} className="badge-blue">{c}<button onClick={() => set(k, list.filter((x) => x !== c))}>×</button></span>)}</div><div className="flex gap-2"><input className="input" placeholder={tr("Chat ID группы или канала (-100…)")} value={v} onChange={(e) => setV(e.target.value)} /><button className="btn-secondary" disabled={!v} onClick={() => { set(k, [...list, v.trim()]); setV('') }}>{tr("Добавить")}</button></div></Field> }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-accent-soft text-sm p-3">{tr("Три Telegram-бота — три задачи:")} <b>{tr("Регистрация")}</b> {tr("(сотрудники: имя, телефон, фото, заявки, статус, зарплата),")} <b>{tr("Посещаемость")}</b> {tr("(живая лента входов/выходов),")} <b>{tr("Опоздания")}</b> {tr("(опоздания и отсутствующие с фото). Плюс")} <b>HikCentral</b> {tr("— источник проходов с терминалов.")}</div>
      <Tabs value={sub} onChange={setSub} items={[{ value: 'bots', label: tr("Боты") }, { value: 'recipients', label: tr("Кому писать") }, { value: 'templates', label: tr("Шаблоны") }, { value: 'hik', label: 'HikCentral' }, { value: 'api', label: 'API' }]} />
      {sub === 'bots' && <div className="space-y-4">
        <BotCard kind="registration" tokenKey="telegram_bot_token" title={tr("Бот регистрации")} desc={tr("Сотрудники пишут /start — регистрация, статус, часы, зарплата, табель, заявки «Не смогу прийти» / «Опаздываю», отметки для удалённых.")}><Field label={tr("Язык бота по умолчанию")}><Select value={f.telegram_default_lang ?? 'ru'} onChange={(v) => set('telegram_default_lang', v)} options={[{ value: 'ru', label: tr("🇷🇺 Русский") }, { value: 'uz', label: "🇺🇿 O'zbek" }]} /></Field></BotCard>
        <BotCard kind="attendance_feed" tokenKey="attendance_feed_bot_token" title={tr("Бот посещаемости")} desc={tr("Живая лента: кто вошёл и вышел, с фото и временем. Кнопки «Список» и «С фото».")} enabledKey="attendance_feed_enabled" />
        <BotCard kind="late_absent" tokenKey="late_absent_bot_token" title={tr("Бот опозданий и отсутствий")} desc={tr("Сообщение на каждого опоздавшего — сразу при входе. Отсутствующие — списком через N часов после начала смены.")} enabledKey="late_absent_enabled"><Field label={tr("Через сколько часов после начала смены считать отсутствующим")}><Select value={f.late_absent_after_hours ?? 2} onChange={(v) => set('late_absent_after_hours', v)} options={[1, 2, 3, 4].map((h) => ({ value: h, label: tr("{{v0}} ч после начала смены", { v0: h }) }))} /></Field></BotCard>
        {Save}</div>}
      {sub === 'recipients' && <div className="space-y-4">
        <Section title={tr("Кому приходят уведомления")} sub={tr("Выберите сотрудников из списка — им не нужно вводить Chat ID вручную. Уведомления идут через бот регистрации.")}>
          <PeopleList keyIds="telegram_manager_employee_ids" label={tr("Руководители")} hint={tr("Опоздания, табель, зарплата, изменения на сайте.")} />
          <PeopleList keyIds="telegram_hr_employee_ids" label={tr("Кадры (HR) — заявки «Не смогу прийти»")} hint={tr("Сюда приходят заявки с кнопками Принять / Отклонить прямо в Telegram.")} />
          <div className="grid sm:grid-cols-2 gap-3"><ChatIds k="telegram_manager_chat_ids" label={tr("Chat ID руководителей (группа)")} /><ChatIds k="telegram_hr_chat_ids" label={tr("Chat ID кадров (группа)")} /></div>
        </Section>
        <Section title={tr("Бот посещаемости — Chat ID для ленты")} sub={tr("Сюда приходят входы и выходы с фото. Также получают все, кто нажал /start и был принят в разделе Уведомления → Подписка.")}><ChatIds k="attendance_feed_chat_ids" label="Chat ID" /></Section>
        <Section title={tr("Бот опозданий — Chat ID для уведомлений")}><ChatIds k="late_absent_chat_ids" label="Chat ID" /></Section>
        {Save}</div>}
      {sub === 'templates' && <TemplatesEditor f={f} set={set} save={Save} />}
      {sub === 'hik' && <Section title="HikCentral Professional (OpenAPI)" sub={tr("Проходы с терминалов Face ID забираются из HikCentral каждые ~45 секунд. Сотрудники сопоставляются по HikCentral person ID или табельному номеру (personCode / cardNo).")}>
        <Toggle checked={!!f.hik_enabled} onChange={(v) => set('hik_enabled', v)} label={tr("Включить синхронизацию с HikCentral")} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={tr("Базовый URL")} hint={tr("Например: https://192.168.1.10:443")}><input className="input" value={f.hik_base_url ?? ''} onChange={(e) => set('hik_base_url', e.target.value)} /></Field>
          <Field label="AppKey (partner key)"><input className="input font-mono" value={f.hik_app_key ?? ''} onChange={(e) => set('hik_app_key', e.target.value)} /></Field>
          <Field label="AppSecret" hint={s.hik_app_secret_set ? tr("Секрет сохранён. Вставьте новый, чтобы заменить.") : tr("Из OpenAPI → Partner в HikCentral")}><input className="input font-mono" type="password" value={tokens.hik_app_secret} onChange={(e) => setTokens({ ...tokens, hik_app_secret: e.target.value })} placeholder={s.hik_app_secret_set ? '••••••••' : ''} /></Field>
          <Field label={tr("Проверять SSL-сертификат")}><Toggle checked={!!f.hik_verify_ssl} onChange={(v) => set('hik_verify_ssl', v)} label={tr("Включить")} hint={tr("Выключите для самоподписанных сертификатов")} /></Field>
        </div>
        <div className="text-xs text-muted">{tr("Последнее событие:")} {f.hik_last_event_time ? fmtDateTime(f.hik_last_event_time) : '—'}</div>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={testHik}><Wifi className="h-4 w-4" />{tr("Проверить подключение")}</button><button className="btn-secondary" onClick={syncHik}><RefreshCw className="h-4 w-4" />{tr("Синхронизировать сейчас")}</button><div className="flex-1" />{Save}</div>
      </Section>}
      {sub === 'api' && <Section title="Integration API" sub={tr("Только чтение + приём событий. Другой проект запрашивает сотрудников, часы и зарплату по месяцу через API-ключ; терминалы других вендоров могут отправлять проходы.")}>
        <div className="rounded-xl bg-elevated p-3 text-xs font-mono space-y-1"><div>{tr("Базовый URL:")} <b>{location.origin}/api/v1/integration</b></div><div className="text-muted">GET /me · GET /employees · GET /payroll/month?year=&month= · GET /employees/{'{id}'}/payroll?year=&month= · POST /events {'{employee_number, event_time, direction}'}</div><div className="text-muted mt-1">curl -H "Authorization: Bearer YOUR_API_KEY" "{location.origin}/api/v1/integration/payroll/month?year=2026&month=9"</div></div>
        <table className="table"><thead><tr><th>{tr("Название")}</th><th>{tr("Ключ")}</th><th>{tr("Создан")}</th><th>{tr("Последнее использование")}</th><th /></tr></thead><tbody>{(keys.data ?? []).map((k) => <tr key={k.id} className={clsx(k.revoked_at && 'opacity-50 line-through')}><td className="font-medium">{k.name}</td><td className="font-mono text-xs">{k.prefix}</td><td className="text-xs">{fmtDateTime(k.created_at)}</td><td className="text-xs text-muted">{k.last_used_at ? fmtDateTime(k.last_used_at) : tr("Ещё не использовался")}</td><td className="text-right">{!k.revoked_at && <button className="btn-ghost btn-sm text-danger" onClick={async () => { await api.delete(`/integrations/api-keys/${k.id}`); qc.invalidateQueries({ queryKey: ['api-keys'] }) }}>{tr("Отозвать")}</button>}</td></tr>)}</tbody></table>
        <div className="flex gap-2"><input className="input" placeholder={tr("Название ключа")} value={keyName} onChange={(e) => setKeyName(e.target.value)} /><button className="btn-primary whitespace-nowrap" onClick={createKey}><Plus className="h-4 w-4" />{tr("Создать ключ")}</button></div>
        {newKey && <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm"><div className="font-medium mb-1">{tr("Ключ создан — скопируйте сейчас, он больше не будет показан:")}</div><div className="flex gap-2"><code className="flex-1 break-all text-xs font-mono">{newKey}</code><button className="btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(newKey); toast.push(tr("Скопировано")) }}><Copy className="h-3.5 w-3.5" /></button></div></div>}
      </Section>}
    </div>
  )
}

function TemplatesEditor({ f, set, save }: { f: S; set: (k: string, v: unknown) => void; save: ReactNode }) {
  const [lang, setLang] = useState<'ru' | 'uz'>('ru')
  const defaults = useQuery({ queryKey: ['tpl-defaults'], queryFn: async () => (await api.get('/settings/defaults')).data })
  const KEYS: [string, string][] = [['welcome', tr("👋 Приветствие /start")], ['help', tr("📖 Справка")], ['ask_full_name', tr("👤 Шаг 1 — имя")], ['ask_phone', tr("📞 Шаг 2 — телефон")], ['ask_photo', tr("📸 Шаг 3 — фото")], ['success', tr("🎉 Успешная регистрация")], ['success_linked', tr("🔗 Привязка существующего")], ['already_registered', tr("✅ Уже зарегистрирован")], ['not_registered', tr("⚠️ Не зарегистрирован")], ['status_registered', tr("📊 Статус")], ['hours', tr("⏱ Часы")], ['salary', tr("💰 Зарплата")], ['ask_absence_date', tr("📅 Заявка — дата")], ['ask_absence_reason', tr("✍️ Заявка — причина")], ['absence_sent', tr("📨 Заявка отправлена")], ['ask_late_minutes', tr("⏰ Опоздание — минуты")], ['late_sent', tr("📨 Опоздание отправлено")], ['request_approved', tr("✅ Заявка принята")], ['request_rejected', tr("❌ Заявка отклонена")], ['new_task', tr("📋 Новая задача")], ['task_approved', tr("✅ Задача подтверждена")], ['feed_pass', tr("🟢 Лента: проход")], ['late_alert', tr("⏰ Оповещение об опоздании")], ['absent_alert', tr("🚫 Список не пришедших")], ['hr_request', tr("📨 Заявка для HR")]]
  const key = `telegram_templates_${lang}`
  const cur: S = f[key] ?? {}
  return (
    <Section title={tr("Шаблоны сообщений")} sub={tr("Тексты бота для сотрудников. HTML и emoji. Переменные:") + " {full_name}, {phone}, {employee_number}, {company}, {date}, {time}, {late}, {title}, {bonus}, {reason}"} right={<Tabs value={lang} onChange={setLang} items={[{ value: 'ru', label: tr("🇷🇺 Русский") }, { value: 'uz', label: "🇺🇿 O'zbek" }]} />}>
      <div className="grid md:grid-cols-2 gap-3">{KEYS.map(([k, l]) => <Field key={k} label={l}><textarea className="input text-xs font-mono" rows={3} value={cur[k] ?? ''} placeholder={tr("по умолчанию")} onChange={(e) => set(key, { ...cur, [k]: e.target.value })} /></Field>)}</div>
      <div className="flex justify-between"><button className="btn-secondary" onClick={() => set(key, {})}>{tr("Сбросить шаблоны")}</button>{save}</div>
    </Section>
  )
}

/* ---------------------------------------------------------------- Activity log */

function ActivityLog() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const data = useQuery({ queryKey: ['activity', q, cat], queryFn: async () => (await api.get('/activity', { params: { q: q || undefined, category: cat, limit: 300 } })).data as { total: number; items: { id: number; actor: string; ip: string; user_agent: string; category: string; action: string; details: string; amount: string | null; created_at: string }[] } })
  const CAT: Record<string, string> = { auth: tr("Вход / безопасность"), employees: tr("Сотрудники"), finance: tr("Финансы"), attendance: tr("Посещаемость"), schedules: tr("Графики"), structure: tr("Структура"), settings: tr("Настройки"), tasks: tr("Задачи"), devices: tr("Устройства"), integrations: tr("Интеграции"), platform: tr("Платформа"), other: tr("Другое") }
  return (
    <Section title={tr("Журнал")} sub={tr("Все действия в системе: входы, изменения, IP-адреса · {{v0}} / {{v1}}", { v0: data.data?.items.length ?? 0, v1: data.data?.total ?? 0 })}>
      <div className="flex flex-wrap gap-2"><div className="relative flex-1 min-w-56"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9" placeholder={tr("Поиск")} value={q} onChange={(e) => setQ(e.target.value)} /></div><Select className="w-56" value={cat} onChange={setCat} options={[{ value: 'all', label: tr("Все действия") }, ...Object.entries(CAT).map(([v, l]) => ({ value: v, label: l }))]} /></div>
      <div className="overflow-x-auto"><table className="table"><thead><tr><th>{tr("Время")}</th><th>{tr("Пользователь")}</th><th>{tr("IP / устройство")}</th><th>{tr("Действие")}</th><th>{tr("Подробности")}</th></tr></thead><tbody>
        {(data.data?.items ?? []).map((l) => <tr key={l.id}><td className="whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</td><td className="font-medium">{l.actor}</td><td className="text-xs text-muted"><div>{l.ip}</div><div className="truncate max-w-48" title={l.user_agent}>{l.user_agent}</div></td><td><div className="text-xs font-medium">{CAT[l.category] ?? l.category}</div><div className="text-[10px] text-muted">{l.action}</div></td><td className="text-sm max-w-md">{l.details}{l.amount != null && <div className={clsx('text-xs font-semibold', +l.amount < 0 ? 'text-danger' : 'text-success')}>{money(l.amount)}</div>}</td></tr>)}
      </tbody></table></div>{data.isLoading ? <Spinner /> : !data.data?.items.length && <Empty />}
    </Section>
  )
}

/* ---------------------------------------------------------------- License */

function LicenseTab() {
  const q = useQuery({ queryKey: ['license'], queryFn: async () => (await api.get('/license')).data })
  if (q.isLoading || !q.data) return <Spinner />
  const l = q.data
  return (
    <Section title={tr("Лицензия")}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[[tr("Тариф"), l.plan_name, l.is_test_mode ? tr("ТЕСТ") : tr("ОПЛАЧЕН")], [tr("Действует до"), l.valid_until ? fmtDateTime(l.valid_until) : '—', l.days_remaining != null ? tr("{{v0}} дн. осталось", { v0: l.days_remaining }) : ''], [tr("Сотрудники"), `${l.employee_count} / ${l.max_employees}`, ''], [tr("Устройства"), `${l.device_count} / ${l.max_devices}`, tr("Филиалы: {{v0}} / {{v1}}", { v0: l.branch_count, v1: l.max_branches })]].map(([k, v, s]) => <div key={String(k)} className="rounded-xl bg-elevated p-4"><div className="text-[10px] uppercase text-muted">{k}</div><div className="text-lg font-bold mt-1">{v}</div>{s && <div className="text-xs text-muted">{s}</div>}</div>)}
      </div>
      {l.access_blocked && <div className="rounded-xl bg-danger/10 text-danger p-3 text-sm">{tr("Доступ ограничен:")} {l.block_reason}</div>}
      <div className="text-xs text-muted">{tr("Для продления обратитесь к поставщику системы.")}</div>
    </Section>
  )
}
