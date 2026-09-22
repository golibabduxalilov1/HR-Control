import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { Camera, ChevronDown, Loader2, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '@/api/client'
import { Avatar, Field, Modal, MoneyInput, Select, Spinner, Toggle, useToast } from '@/components/ui'
import { fmtDate, fmtDateTime, money, rateLabel, rateSuffix, todayISO } from '@/lib/format'

type Form = {
  full_name: string; phone: string; employee_number: string; department_id: number | null; position_id: number | null; branch_id: number | null
  schedule_id: number | null; night_schedule_id: number | null; schedule_mode: 'fixed' | 'two_shifts' | 'flexible'; work_mode: 'office' | 'remote' | 'hybrid'
  status: 'active' | 'leave' | 'dismissed'; hire_date: string; dismiss_date: string; birth_date: string; telegram_chat_id: string; auto_fines_enabled: boolean; notes: string; hik_person_id: string
  passport_series: string; passport_number: string; passport_issued_by: string; passport_issue_date: string; passport_expiry_date: string; pinfl: string; address: string
}
const empty: Form = { full_name: '', phone: '', employee_number: '', department_id: null, position_id: null, branch_id: null, schedule_id: null, night_schedule_id: null, schedule_mode: 'fixed', work_mode: 'office', status: 'active', hire_date: todayISO(), dismiss_date: '', birth_date: '', telegram_chat_id: '', auto_fines_enabled: true, notes: '', hik_person_id: '', passport_series: '', passport_number: '', passport_issued_by: '', passport_issue_date: '', passport_expiry_date: '', pinfl: '', address: '' }

const numWords = (n: number) => {
  if (!n) return ''
  const units = ['', tr("тысяч"), tr("миллион"), tr("миллиард")]
  const parts: string[] = []
  let i = 0
  while (n > 0 && i < units.length) { const c = n % 1000; if (c) parts.unshift(`${c} ${units[i]}`.trim()); n = Math.floor(n / 1000); i++ }
  return parts.join(' ') + tr(" сум")
}

export function EmployeeForm({ employeeId, onClose, onSaved }: { employeeId?: number; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState<Form>(empty)
  const [rateType, setRateType] = useState<'monthly' | 'hourly' | 'piece'>('monthly')
  const [rateAmount, setRateAmount] = useState('')
  const [rateFrom, setRateFrom] = useState(todayISO().slice(0, 8) + '01')
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [more, setMore] = useState(false)
  const [passport, setPassport] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }))

  const emp = useQuery({ queryKey: ['employee', employeeId], queryFn: async () => (await api.get(`/employees/${employeeId}`)).data, enabled: !!employeeId })
  const deps = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as { id: number; name: string }[] })
  const positions = useQuery({ queryKey: ['positions'], queryFn: async () => (await api.get('/positions')).data as { id: number; name: string; department_id: number | null }[] })
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: async () => (await api.get('/schedules')).data as { id: number; name: string; start_time: string | null; end_time: string | null; type: string }[] })
  const branches = useQuery({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data as { id: number; name: string }[] })
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings')).data })

  useEffect(() => {
    if (emp.data) {
      const e = emp.data
      setF({ full_name: e.full_name, phone: e.phone, employee_number: e.employee_number, department_id: e.department_id, position_id: e.position_id, branch_id: e.branch_id, schedule_id: e.schedule_id, night_schedule_id: e.night_schedule_id, schedule_mode: e.schedule_mode, work_mode: e.work_mode, status: e.status, hire_date: e.hire_date ?? '', dismiss_date: e.dismiss_date ?? '', birth_date: e.birth_date ?? '', telegram_chat_id: e.telegram_chat_id ?? '', auto_fines_enabled: e.auto_fines_enabled, notes: e.notes ?? '', hik_person_id: e.hik_person_id ?? '', passport_series: e.passport_series ?? '', passport_number: e.passport_number ?? '', passport_issued_by: e.passport_issued_by ?? '', passport_issue_date: e.passport_issue_date ?? '', passport_expiry_date: e.passport_expiry_date ?? '', pinfl: e.pinfl ?? '', address: e.address ?? '' })
      if (e.passport_number || e.pinfl) setPassport(true)
      if (e.current_rate) setRateType(e.current_rate.rate_type)
    }
  }, [emp.data])

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, employee_number: f.employee_number || null, hire_date: f.hire_date || null, dismiss_date: f.dismiss_date || null, birth_date: f.birth_date || null, telegram_chat_id: f.telegram_chat_id || null, hik_person_id: f.hik_person_id || null, passport_issue_date: f.passport_issue_date || null, passport_expiry_date: f.passport_expiry_date || null,
        salary_rate: !employeeId && rateAmount ? { rate_type: rateType, amount: Number(rateAmount), effective_from: rateFrom } : null }
      const { data } = employeeId ? await api.put(`/employees/${employeeId}`, body) : await api.post('/employees', body)
      if (pendingPhoto) { const fd = new FormData(); fd.append('file', pendingPhoto); await api.post(`/employees/${data.id}/avatar`, fd) }
      return data
    },
    onSuccess: () => { toast.push(employeeId ? tr("Сотрудник обновлён") : tr("Сотрудник добавлен")); qc.invalidateQueries(); onSaved() },
    onError: (e) => toast.push(errorMessage(e), 'error'),
  })
  const addRate = useMutation({ mutationFn: async () => api.post(`/employees/${employeeId}/salary-rates`, { rate_type: rateType, amount: Number(rateAmount), effective_from: rateFrom }), onSuccess: () => { toast.push(tr("Ставка добавлена")); setRateAmount(''); qc.invalidateQueries({ queryKey: ['employee', employeeId] }) }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const delRate = useMutation({ mutationFn: async (id: number) => api.delete(`/employees/${employeeId}/salary-rates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['employee', employeeId] }) })
  const uploadPhoto = useMutation({ mutationFn: async (file: File) => { const fd = new FormData(); fd.append('file', file); return api.post(`/employees/${employeeId}/avatar`, fd) }, onSuccess: () => { toast.push(tr("Фото обновлено")); qc.invalidateQueries() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const delPhoto = useMutation({ mutationFn: async () => api.delete(`/employees/${employeeId}/avatar`), onSuccess: () => qc.invalidateQueries() })
  const unlinkTg = () => set('telegram_chat_id', '')

  if (employeeId && emp.isLoading) return <Modal open onClose={onClose} title={tr("Редактировать")}><Spinner /></Modal>
  const positionOpts = (positions.data ?? []).filter((p) => !f.department_id || p.department_id === f.department_id || p.department_id === null)
  const schedOpts = (schedules.data ?? []).map((s) => ({ value: s.id, label: s.start_time ? `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time?.slice(0, 5)}` : tr("{{v0}} (гибкий)", { v0: s.name }) }))
  const previewUrl = pendingPhoto ? URL.createObjectURL(pendingPhoto) : emp.data?.avatar_url

  return (
    <Modal open onClose={onClose} title={employeeId ? tr("Редактировать сотрудника") : tr("Добавить сотрудника")} icon={<UserPlus className="h-5 w-5" />} size="lg"
      footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!f.full_name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Сохранить")}</button></>}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={f.full_name || '?'} src={previewUrl} size={64} />
          <div className="text-sm">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Camera className="h-3.5 w-3.5" />{previewUrl ? tr("Заменить фото") : tr("Загрузить фото")}</button>
              {employeeId && emp.data?.avatar_url && <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => delPhoto.mutate()}><Trash2 className="h-3.5 w-3.5" /></button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (employeeId) uploadPhoto.mutate(file); else setPendingPhoto(file) }} />
            </div>
            <div className="text-xs text-muted mt-1">{tr("Лицо анфас — это же фото уйдёт на терминал")}{settings.data?.settings?.hik_enabled && ' (HikCentral)'}</div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={tr("ФИО")} className="sm:col-span-2"><input className="input" placeholder={tr("Фамилия Имя")} value={f.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus /></Field>
          <Field label={tr("Телефон")}><input className="input" placeholder="+998 90 123 45 67" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={tr("Дата выхода на работу")} hint={tr("С этой даты считаются график и штрафы")}><input type="date" className="input" value={f.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></Field>
          <Field label={tr("Подразделение")}><Select value={f.department_id} onChange={(v) => { set('department_id', v); set('position_id', null) }} placeholder="—" options={[{ value: null, label: '—' }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} /></Field>
          <Field label={tr("Должность")}><Select value={f.position_id} onChange={(v) => set('position_id', v)} placeholder="—" options={[{ value: null, label: '—' }, ...positionOpts.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
          <Field label={tr("График работы")} className="sm:col-span-2" hint={f.schedule_mode === 'flexible' ? tr("Без графика: считаются только фактические часы, опозданий нет") : undefined}>
            <Select value={f.schedule_mode === 'flexible' ? 0 : f.schedule_id} onChange={(v) => { if (v === 0) { set('schedule_mode', 'flexible'); set('schedule_id', null) } else { set('schedule_mode', f.schedule_mode === 'flexible' ? 'fixed' : f.schedule_mode); set('schedule_id', v) } }}
              placeholder={tr("Выберите график")} options={[...schedOpts, { value: 0, label: tr("Без графика (по факту)") }]} /></Field>
        </div>

        <div className="rounded-lg border border-line p-4 space-y-3">
          <div className="flex items-center justify-between"><div className="text-sm font-medium">{tr("Оплата труда")}</div>
            <div className="inline-flex rounded-full border border-subtle overflow-hidden divide-x divide-subtle">{(['monthly', 'hourly', 'piece'] as const).map((r) => <button key={r} type="button" className={clsx('tab m3-state', rateType === r && 'tab-active')} onClick={() => setRateType(r)}>{rateLabel(r)}</button>)}</div></div>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <Field label={rateType === 'monthly' ? tr("Оклад в месяц") : rateType === 'hourly' ? tr("Ставка в час") : tr("Ставка за единицу")} hint={rateAmount ? numWords(Number(rateAmount)) : rateType === 'piece' ? tr("Выработка вносится в карточке сотрудника → Финансы") : undefined}><MoneyInput value={rateAmount} onChange={setRateAmount} /></Field>
            <Field label={tr("Действует с")}><input type="date" className="input" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} /></Field>
            {employeeId ? <button type="button" className="btn-secondary" disabled={!rateAmount || addRate.isPending} onClick={() => addRate.mutate()}>{tr("Добавить ставку")}</button> : <div className="text-xs text-muted pb-2">{tr("Сохранится вместе с сотрудником")}</div>}
          </div>
          {!!emp.data?.salary_rates?.length && <table className="table text-xs"><thead><tr><th>{tr("Действует с")}</th><th>{tr("Тип")}</th><th className="text-right">{tr("Сумма")}</th><th /></tr></thead><tbody>
            {emp.data.salary_rates.map((r: { id: number; effective_from: string; rate_type: string; amount: string; created_at: string }) => <tr key={r.id}><td>{fmtDate(r.effective_from)}</td><td>{rateLabel(r.rate_type)}</td><td className="text-right font-medium">{money(r.amount)}{rateSuffix(r.rate_type)}</td><td className="text-right"><button type="button" className="btn-ghost btn-sm text-danger" onClick={() => delRate.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></button></td></tr>)}
          </tbody></table>}
        </div>

        <div className="rounded-lg border border-line">
          <button type="button" className="w-full flex items-center justify-between px-4 py-3 text-sm cursor-pointer" onClick={() => setPassport(!passport)}>
            <span className="font-medium">{tr("Паспортные данные")}</span>
            <span className="flex items-center gap-2 text-muted text-xs">{!passport && (f.passport_number || f.pinfl ? `${f.passport_series}${f.passport_number}${f.pinfl ? tr(" · ПИНФЛ {{v0}}", { v0: f.pinfl }) : ''}` : tr("не заполнены"))}<ChevronDown className={clsx('h-4 w-4 transition', passport && 'rotate-180')} /></span>
          </button>
          {passport && <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
            <Field label={tr("Серия и номер паспорта")}><div className="flex gap-2"><input className="input !w-20 uppercase text-center" placeholder="AA" maxLength={4} value={f.passport_series} onChange={(e) => set('passport_series', e.target.value.toUpperCase())} /><input className="input tabular-nums" placeholder="1234567" inputMode="numeric" maxLength={9} value={f.passport_number} onChange={(e) => set('passport_number', e.target.value.replace(/\s/g, ''))} /></div></Field>
            <Field label={tr("ПИНФЛ")} hint={tr("14 цифр")}><input className="input tabular-nums" placeholder="30101900123456" inputMode="numeric" maxLength={14} value={f.pinfl} onChange={(e) => set('pinfl', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label={tr("Кем выдан")} className="sm:col-span-2"><input className="input" placeholder={tr("ИИБ Яккасарайского района")} value={f.passport_issued_by} onChange={(e) => set('passport_issued_by', e.target.value)} /></Field>
            <Field label={tr("Дата выдачи")}><input type="date" className="input" value={f.passport_issue_date} onChange={(e) => set('passport_issue_date', e.target.value)} /></Field>
            <Field label={tr("Действителен до")}><input type="date" className="input" value={f.passport_expiry_date} onChange={(e) => set('passport_expiry_date', e.target.value)} /></Field>
            <Field label={tr("Дата рождения")}><input type="date" className="input" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></Field>
            <Field label={tr("Адрес прописки")}><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
          </div>}
        </div>

        <button type="button" className="flex items-center gap-1 text-sm text-muted hover:text-ink cursor-pointer" onClick={() => setMore(!more)}><ChevronDown className={clsx('h-4 w-4 transition', more && 'rotate-180')} />{tr("Дополнительно")} {!more && <span className="text-subtle">{tr("— статус, Telegram, режим работы, штрафы, табельный номер")}</span>}</button>
        {more && <div className="grid sm:grid-cols-2 gap-3">
          <Field label={tr("Статус")}><Select value={f.status} onChange={(v) => set('status', v)} options={[{ value: 'active', label: tr("Активный") }, { value: 'leave', label: tr("В отпуске") }, { value: 'dismissed', label: tr("Уволен") }]} /></Field>
          {f.status === 'dismissed' && <Field label={tr("Дата увольнения")}><input type="date" className="input" value={f.dismiss_date} onChange={(e) => set('dismiss_date', e.target.value)} /></Field>}
          <Field label={tr("Режим работы")}><Select value={f.work_mode} onChange={(v) => set('work_mode', v)} options={[{ value: 'office', label: tr("Офис (терминал)") }, { value: 'remote', label: tr("Удалённо"), hint: tr("Отметки через Telegram") }, { value: 'hybrid', label: tr("Гибрид") }]} /></Field>
          <Field label={tr("Режим графика")}><Select value={f.schedule_mode} onChange={(v) => set('schedule_mode', v)} options={[{ value: 'fixed', label: tr("Один график") }, { value: 'two_shifts', label: tr("Два графика (день / ночь)") }, { value: 'flexible', label: tr("Без графика (по факту)") }]} /></Field>
          {f.schedule_mode === 'two_shifts' && <Field label={tr("Ночной график")}><Select value={f.night_schedule_id} onChange={(v) => set('night_schedule_id', v)} options={[{ value: null, label: '—' }, ...schedOpts]} /></Field>}
          <Field label={tr("Табельный номер")} hint={tr("Номер лица/карты на терминале; пусто — присвоится автоматически")}><input className="input" placeholder={tr("авто")} value={f.employee_number} onChange={(e) => set('employee_number', e.target.value)} /></Field>
          <Field label="Telegram chat ID" hint={emp.data?.telegram_username ? tr("@{{v0}} · подключён", { v0: emp.data.telegram_username }) : tr("Сотрудник получит ID командой /chatid в боте")}>
            <div className="flex gap-2"><input className="input" placeholder="123456789" value={f.telegram_chat_id} onChange={(e) => set('telegram_chat_id', e.target.value)} />{f.telegram_chat_id && <button type="button" className="btn-secondary btn-sm whitespace-nowrap" onClick={unlinkTg}>{tr("Отключить")}</button>}</div></Field>
          {(branches.data?.length ?? 0) > 0 && <Field label={tr("Филиал")}><Select value={f.branch_id} onChange={(v) => set('branch_id', v)} options={[{ value: null, label: tr("Главный офис") }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} /></Field>}
          {settings.data?.settings?.hik_enabled && <Field label="HikCentral person ID"><input className="input" value={f.hik_person_id} onChange={(e) => set('hik_person_id', e.target.value)} /></Field>}
          <Field label={tr("Автоштрафы")} className="sm:col-span-2"><Toggle checked={f.auto_fines_enabled} onChange={(v) => set('auto_fines_enabled', v)} label={tr("Штрафовать автоматически за опоздания и прогулы")} /></Field>
          <Field label={tr("Заметки")} className="sm:col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>}
      </div>
    </Modal>
  )
}
