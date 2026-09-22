import { useQuery } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { clsx } from 'clsx'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { Avatar } from '@/components/ui'
import { useAuth } from '@/store/auth'

type Hit = { id: number; full_name: string; position: string | null; department: string | null; avatar_url: string | null }

const PAGES = [
  [tr("Главная"), ''], [tr("Сегодня"), 'today'], [tr("Сотрудники"), 'employees'], [tr("Графики"), 'schedules'], [tr("Табель"), 'timesheet'],
  [tr("Расчёты"), 'payroll'], [tr("Задачи"), 'tasks'], [tr("Уведомления"), 'notifications'], [tr("Настройки"), 'settings'],
]

/** Ctrl+K / search field in the sidebar: find an employee or jump to a page. */
export function CommandSearch({ open, onClose, onOpenEmployee }: { open: boolean; onClose: () => void; onOpenEmployee: (id: number) => void }) {
  const nav = useNavigate()
  const { slug } = useAuth()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [idx, setIdx] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 150); return () => clearTimeout(h) }, [q])
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => ref.current?.focus(), 30) } }, [open])
  const hits = useQuery({ queryKey: ['search', debounced], queryFn: async () => (await api.get('/dashboard/search', { params: { q: debounced } })).data.employees as Hit[], enabled: open && debounced.length >= 2 })
  const pages = PAGES.filter(([l]) => !q || l.toLowerCase().includes(q.toLowerCase()))
  const items: { kind: 'emp' | 'page'; label: string; sub?: string; avatar?: string | null; run: () => void }[] = [
    ...(hits.data ?? []).map((h) => ({ kind: 'emp' as const, label: h.full_name, sub: [h.position, h.department].filter(Boolean).join(' · '), avatar: h.avatar_url, run: () => { onOpenEmployee(h.id); onClose() } })),
    ...pages.map(([l, to]) => ({ kind: 'page' as const, label: l, run: () => { nav(`/${slug}/${to}`); onClose() } })),
  ]
  useEffect(() => { setIdx(0) }, [debounced, hits.data])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-slate-900/40" />
      <div className="relative card shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-line"><Search className="h-4 w-4 text-subtle" />
          <input ref={ref} className="flex-1 py-3 text-sm outline-none bg-transparent" placeholder={tr("Сотрудник, табельный номер, телефон или раздел…")} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) } if (e.key === 'Enter') items[idx]?.run(); if (e.key === 'Escape') onClose() }} />
          <kbd className="text-[10px] text-subtle border border-line rounded px-1">Esc</kbd></div>
        <div className="max-h-80 overflow-auto py-1">
          {items.map((it, i) => (
            <button key={it.kind + it.label} onMouseEnter={() => setIdx(i)} onClick={it.run} className={clsx('w-full flex items-center gap-3 px-4 py-2 text-left text-sm cursor-pointer', i === idx && 'bg-elevated')}>
              {it.kind === 'emp' ? <Avatar name={it.label} src={it.avatar} size={26} /> : <span className="h-[26px] w-[26px] rounded-md bg-elevated text-subtle flex items-center justify-center text-[10px]">→</span>}
              <span className="flex-1 truncate">{it.label}{it.sub && <span className="text-muted"> · {it.sub}</span>}</span>
              <span className="text-[10px] text-subtle">{it.kind === 'emp' ? tr("сотрудник") : tr("раздел")}</span>
            </button>
          ))}
          {!items.length && <div className="px-4 py-6 text-sm text-muted text-center">{tr("Ничего не найдено")}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
