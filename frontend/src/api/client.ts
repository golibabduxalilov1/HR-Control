import axios, { AxiosError } from 'axios'
import { useAuth } from '@/store/auth'

export const api = axios.create({ baseURL: '/api', timeout: 60_000 })

api.interceptors.request.use((config) => {
  const { token, slug } = useAuth.getState()
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (slug) config.headers['X-WP-Project-Slug'] = slug
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: unknown }>) => {
    if (error.response?.status === 401 && useAuth.getState().token) {
      useAuth.getState().logout()
    }
    return Promise.reject(error)
  },
)

export function errorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) return d.map((x: { msg?: string }) => x.msg).filter(Boolean).join('; ') || 'Ошибка запроса'
    return e.message
  }
  return e instanceof Error ? e.message : 'Ошибка'
}

/** Derive the tenant slug from the first URL segment: /demo/... */
export function slugFromPath(): string | null {
  const seg = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || ''
  const reserved = new Set(['workplace', 'api', 'assets', 'login'])
  return seg && !reserved.has(seg) && /^[a-z][a-z0-9-]{1,46}$/.test(seg) ? seg : null
}
