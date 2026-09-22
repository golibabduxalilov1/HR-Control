import { clsx } from 'clsx'
import { tr } from '@/i18n'
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { initials } from '@/lib/format'

/* ------------------------------------------------------------------ Toast */

type Toast = { id: number; text: string; kind: 'success' | 'error' | 'info' }
const ToastCtx = createContext<{ push: (text: string, kind?: Toast['kind']) => void }>({ push: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random()
    setItems((s) => [...s, { id, text, kind }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 left-4 sm:left-auto sm:right-4 z-[100] flex flex-col gap-2 max-w-sm">
          {items.map((t) => (
            <div key={t.id} className="rounded px-4 py-3.5 text-sm flex items-start gap-3 animate-fade-in min-w-[288px]" style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)', boxShadow: 'var(--shadow-md)' }}>
              {t.kind === 'success' ? <Check className="h-4 w-4 mt-0.5 shrink-0" /> : t.kind === 'error' ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/* ------------------------------------------------------------------ Modal */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; icon?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw]' }[size]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40" />
      <div className={clsx('relative w-full max-h-[94vh] flex flex-col animate-fade-in rounded-t-[28px] sm:rounded-[28px] bg-elevated', w)} style={{ boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="min-w-0 flex-1">
            <div className="text-2xl leading-8 font-normal text-ink truncate">{title}</div>
            {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
          </div>
          <button className="btn-ghost btn-sm !px-2 -mr-2 -mt-2 !text-muted" onClick={onClose} aria-label={tr("Закрыть")}><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-6 pb-4 flex-1">{children}</div>
        {footer && <div className="px-6 pb-6 pt-2 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({ open, onClose, onConfirm, title, text, danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; text?: ReactNode; danger?: boolean; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<>
      <button className="btn-ghost" onClick={onClose}>{tr("Отмена")}</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{tr("Подтвердить")}</button>
    </>}>
      <div className="text-sm text-muted">{text}</div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Select / dropdown */

export function Select<T extends string | number | null>({ value, onChange, options, placeholder = '—', className, disabled }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: string }[]; placeholder?: string; className?: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const current = options.find((o) => o.value === value)
  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between gap-2 text-left cursor-pointer disabled:opacity-60">
        <span className={clsx('truncate', !current && 'text-subtle')}>{current?.label ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 text-subtle shrink-0" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-lg bg-elevated py-2 max-h-64 overflow-auto" style={{ boxShadow: 'var(--shadow-sm)' }}>
          {options.map((o) => (
            <button type="button" key={String(o.value)} onClick={() => { onChange(o.value); setOpen(false) }}
              className={clsx('w-full text-left px-3 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer', o.value === value && 'bg-accent-soft text-accent font-medium')}>
              <div>{o.label}</div>
              {o.hint && <div className="text-xs text-muted">{o.hint}</div>}
            </button>
          ))}
          {options.length === 0 && <div className="px-3 py-2 text-sm text-muted">{tr("Нет вариантов")}</div>}
        </div>
      )}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex items-start gap-3 cursor-pointer select-none', disabled && 'opacity-60 cursor-not-allowed')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-8 w-[52px] shrink-0 rounded-full transition border-2 cursor-pointer', checked ? 'bg-accent border-accent' : 'bg-elevated border-subtle')}>
        <span className={clsx('absolute top-1/2 -translate-y-1/2 rounded-full transition-all', checked ? 'left-[22px] h-6 w-6 bg-white' : 'left-1.5 h-4 w-4 bg-subtle')} />
      </button>
      {(label || hint) && <span className="min-w-0"><span className="text-sm text-ink font-medium block">{label}</span>{hint && <span className="text-xs text-muted block mt-0.5">{hint}</span>}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ Bits */

// initials fallback gets a stable gradient per person
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)', 'linear-gradient(135deg,#0ea5e9,#2563eb)', 'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#f97316)', 'linear-gradient(135deg,#ec4899,#e11d48)', 'linear-gradient(135deg,#14b8a6,#0891b2)',
]
const hashName = (n: string) => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [err, setErr] = useState(false)
  const style = { width: size, height: size, fontSize: size * 0.38 }
  if (src && !err) return <img src={src} alt="" onError={() => setErr(true)} style={style} className={clsx('rounded-full object-cover shrink-0', className)} />
  return <div style={{ ...style, backgroundImage: AVATAR_GRADIENTS[hashName(name) % AVATAR_GRADIENTS.length] }} className={clsx('rounded-full text-white font-semibold flex items-center justify-center shrink-0', className)}>{initials(name) || '?'}</div>
}

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'violet'
const TONE_CHIP: Record<Tone, string> = { accent: 'bg-accent-soft text-accent', success: 'bg-success/12 text-success', warning: 'bg-warning/14 text-warning', danger: 'bg-danger/12 text-danger', info: 'bg-info/12 text-info', muted: 'bg-elevated text-muted', violet: 'bg-violet/12 text-violet' }

const TONE_VAR: Record<Tone, string> = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', muted: 'var(--text-subtle)', violet: 'var(--violet)' }

export function Kpi({ label, value, sub, icon, tone = 'accent', onClick, active }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; onClick?: () => void; active?: boolean }) {
  return (
    <div className={clsx('kpi', onClick && 'cursor-pointer m3-state transition', active && 'ring-2 ring-accent')} onClick={onClick}
      style={{ background: `color-mix(in srgb, ${TONE_VAR[tone]} 12%, var(--bg-card))` }}>
      <div className="flex items-start justify-between gap-2 min-h-8">
        <div className="text-xs font-medium text-muted leading-snug">{label}</div>
        {icon && <span className={clsx('h-10 w-10 -mt-2 -mr-2 rounded-full flex items-center justify-center shrink-0 [&>svg]:h-5 [&>svg]:w-5', TONE_CHIP[tone])}>{icon}</span>}
      </div>
      <div className={clsx('text-[26px] font-bold mt-1 tabular-nums leading-none tracking-tight text-center', tone === 'muted' ? 'text-muted' : 'text-ink')}>{value}</div>
      <div className="text-sm text-muted mt-1.5 text-center min-h-5">{sub}</div>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <div className={clsx('flex items-center justify-center py-10 text-muted', className)}><Loader2 className="h-6 w-6 animate-spin" /></div>
}

export function Empty({ text = tr("Нет данных"), icon }: { text?: ReactNode; icon?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center py-10 text-muted text-sm gap-2">{icon}<span>{text}</span></div>
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={clsx('inline-flex rounded-full border border-subtle overflow-x-auto max-w-full divide-x divide-subtle', className)}>
      {items.map((it) => (
        <button key={it.value} type="button" onClick={() => onChange(it.value)} className={clsx('tab flex items-center gap-1.5 whitespace-nowrap m3-state', value === it.value && 'tab-active')}>
          {value === it.value && <Check className="h-4 w-4 -ml-1" />}{it.label}{it.count !== undefined && <span className={clsx('text-xs', value === it.value ? 'text-accent/70' : 'text-subtle')}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ page, perPage, total, onPage, onPerPage }: { page: number; perPage: number; total: number; onPage: (p: number) => void; onPerPage?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage))
  const from = total ? (page - 1) * perPage + 1 : 0
  const to = Math.min(page * perPage, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
      <span>{from}–{to} {tr("из")} {total}</span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
        {Array.from({ length: pages }).slice(Math.max(0, page - 3), page + 2).map((_, i) => {
          const n = Math.max(0, page - 3) + i + 1
          return <button key={n} className={clsx('btn-ghost btn-sm min-w-7', n === page && 'bg-accent-soft')} onClick={() => onPage(n)}>{n}</button>
        })}
        <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
        {onPerPage && <select className="input !w-auto !py-1 !px-2 ml-2" value={perPage} onChange={(e) => onPerPage(+e.target.value)}>{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return <div className={className}><label className="label">{label}</label>{children}{hint && <div className="text-xs text-muted mt-1">{hint}</div>}</div>
}

export function MoneyInput({ value, onChange, placeholder = '0', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const display = value ? Number(value).toLocaleString('ru-RU').replace(/,/g, ' ') : ''
  return (
    <div className={clsx('relative', className)}>
      <input className="input pr-12 tabular-nums" inputMode="numeric" placeholder={placeholder} value={display} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{tr("сум")}</span>
    </div>
  )
}

export function SectionTitle({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div><h1 className="text-lg font-semibold text-ink">{title}</h1>{subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}</div>
      {right && <div className="flex flex-wrap gap-2">{right}</div>}
    </div>
  )
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const map: Record<string, string> = {
    on_time: 'badge-green', worked_off: 'badge-green', late: 'badge-yellow', early_leave: 'badge-yellow', late_early: 'badge-yellow', absent: 'badge-red', excused: 'badge-blue',
    remote: 'badge-blue', leave: 'badge-gray', dismissed: 'badge-gray', day_off: 'badge-gray', holiday: 'badge-gray', planned: 'badge-gray', not_hired: 'badge-gray', active: 'badge-green',
    pending: 'badge-yellow', approved: 'badge-green', rejected: 'badge-red', accepted: 'badge-blue', review: 'badge-yellow',
  }
  return <span className={map[status] || 'badge-gray'}>{label ?? status}</span>
}
