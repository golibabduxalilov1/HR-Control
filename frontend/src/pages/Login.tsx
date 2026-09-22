import { Loader2, Lock, User } from 'lucide-react'
import { tr } from '@/i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '@/api/client'
import { useAuth } from '@/store/auth'
import { applyBrandColor } from '@/lib/brand'

export function LoginPage() {
  const { t } = useTranslation()
  const { slug: slugParam } = useParams()
  const nav = useNavigate()
  const login = useAuth((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [slug, setSlug] = useState(slugParam ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!slugParam) return
    api.get('/public/branding', { headers: { 'X-WP-Project-Slug': slugParam } }).then((r) => applyBrandColor(r.data.brand_color)).catch(() => {})
  }, [slugParam])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/auth/login', { username, password, project_slug: slug })
      login(data)
      nav(`/${data.project_slug}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-full grid lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden" style={{ background: 'radial-gradient(1200px 600px at 0% 0%, rgba(99,102,241,.45), transparent 60%), radial-gradient(800px 500px at 100% 100%, rgba(47,91,234,.5), transparent 55%), #0b1220' }}>
        <div className="flex items-center gap-3"><div className="h-9 w-9 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center font-bold">F</div><span className="font-semibold tracking-tight">Face ID Workplace</span></div>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold tracking-tight leading-tight">{tr("Учёт рабочего времени, который считает всё сам")}</h1>
          <p className="mt-4 text-slate-300/90 leading-relaxed">{tr("Проходы с терминалов, табель, опоздания, зарплата и штрафы — в одном месте. Сотрудники получают свой табель и зарплату в Telegram.")}</p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-sm">
            {[[tr("Терминалы"), 'HikCentral'], [tr("Уведомления"), 'Telegram'], [tr("Отчёты"), 'CSV / PDF']].map(([a, b]) => <div key={String(a)} className="rounded-xl border border-white/10 bg-white/[.05] p-3"><div className="text-slate-400 text-xs">{a}</div><div className="font-medium mt-0.5">{b}</div></div>)}
          </div>
        </div>
        <div className="text-xs text-slate-500">© {new Date().getFullYear()} Face ID Workplace</div>
      </div>
      <div className="flex items-center justify-center p-6 bg-main">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-fade-in">
          <div className="lg:hidden flex items-center gap-3 mb-2"><div className="h-9 w-9 rounded-xl bg-accent text-white flex items-center justify-center font-bold">F</div><span className="font-semibold">Face ID Workplace</span></div>
          <div><h2 className="text-2xl font-semibold tracking-tight text-ink">{t('login.title')}</h2><p className="text-sm text-muted mt-1">{tr("Введите логин и пароль, выданные администратором")}</p></div>
          {!slugParam && (
            <div><label className="label">{t('login.project')}</label><input className="input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="demo" autoFocus /></div>
          )}
          <div><label className="label">{t('login.username')}</label>
            <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9 !py-2.5" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus={!!slugParam} /></div></div>
          <div><label className="label">{t('login.password')}</label>
            <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" /><input className="input pl-9 !py-2.5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div></div>
          {error && <div className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</div>}
          <button className="btn-primary w-full !py-2.5 text-[15px]" disabled={loading || !username || !password || !slug}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{t('login.submit')}</button>
        </form>
      </div>
    </div>
  )
}
