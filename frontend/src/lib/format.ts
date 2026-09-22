import { format, parseISO } from 'date-fns'
import i18n, { tr } from '@/i18n'

export const money = (v: number | string | null | undefined, currency?: string) => {
  currency ??= i18n.t('сум')
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'string' ? parseFloat(v) : v
  return `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} ${currency}`
}

export const signedMoney = (v: number | string) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n))
}

export const hm = (minutes: number | null | undefined) => {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.abs(minutes % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export const hmHuman = (minutes: number | null | undefined) => {
  if (!minutes && minutes !== 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} ${i18n.t('ч')} ${m} ${i18n.t('мин')}` : `${m} ${i18n.t('мин')}`
}

export const fmtDate = (iso: string | null | undefined, pattern = 'dd.MM.yyyy') => (iso ? format(parseISO(iso), pattern) : '—')
export const fmtTime = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'HH:mm') : '—')
export const fmtDateTime = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'dd.MM.yyyy HH:mm') : '—')

// Localised calendar names: index access and .map() follow the active i18n language.
const localised = (ru: string[], uz: string[]) => new Proxy(ru, { get: (target, prop) => Reflect.get(i18n.language === 'uz' ? uz : target, prop) })
export const MONTHS = localised(['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'], ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'])
export const WEEKDAYS = localised(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'], ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'])
export const WEEKDAYS_FULL = localised(['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'], ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'])

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)

export const initials = (name: string) => name.split(' ').slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('')

export const STATUS_COLOR: Record<string, string> = {
  on_time: 'badge-green', worked_off: 'badge-green', late: 'badge-yellow', early_leave: 'badge-yellow', late_early: 'badge-yellow',
  absent: 'badge-red', excused: 'badge-blue', remote: 'badge-blue', leave: 'badge-gray', dismissed: 'badge-gray', day_off: 'badge-gray',
  holiday: 'badge-gray', planned: 'badge-gray', not_hired: 'badge-gray', active: 'badge-green', pending: 'badge-yellow', approved: 'badge-green',
  rejected: 'badge-red', accepted: 'badge-blue', review: 'badge-yellow',
}

export const STATUS_DOT: Record<string, string> = {
  on_time: 'bg-success', worked_off: 'bg-success', late: 'bg-warning', early_leave: 'bg-warning', late_early: 'bg-warning', absent: 'bg-danger',
  excused: 'bg-info', remote: 'bg-info', day_off: 'bg-subtle', holiday: 'bg-subtle', planned: 'bg-line', leave: 'bg-subtle', dismissed: 'bg-subtle', not_hired: 'bg-line',
}

export const monthRange = (year: number, month: number) => {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return { date_from: format(start, 'yyyy-MM-dd'), date_to: format(end, 'yyyy-MM-dd') }
}

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

/** Salary rate helpers: label and unit suffix per rate type */
export const rateLabel = (t: string | null | undefined) => (t === 'hourly' ? tr("Почасовая") : t === 'piece' ? tr("Сдельная") : tr("Оклад"))
export const rateSuffix = (t: string | null | undefined) => (t === 'hourly' ? tr("/ч") : t === 'piece' ? tr("/ед.") : '')
