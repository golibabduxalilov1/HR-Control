import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Role = 'admin' | 'operator' | 'hr' | 'manager'

interface AuthState {
  token: string | null
  slug: string | null
  role: Role | null
  displayName: string
  branchId: number | null
  branchName: string | null
  isHq: boolean
  login: (data: { access_token: string; project_slug: string; role: Role; display_name: string; branch_id: number | null; branch_name: string | null; is_hq: boolean }) => void
  logout: () => void
  setSlug: (slug: string | null) => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null, slug: null, role: null, displayName: '', branchId: null, branchName: null, isHq: true,
      login: (d) => set({ token: d.access_token, slug: d.project_slug, role: d.role, displayName: d.display_name, branchId: d.branch_id, branchName: d.branch_name, isHq: d.is_hq }),
      logout: () => set({ token: null, role: null, displayName: '', branchId: null, branchName: null, isHq: true }),
      setSlug: (slug) => set({ slug }),
    }),
    { name: 'faceid-auth' },
  ),
)

export const isAdmin = (role: Role | null) => role === 'admin'
export const canEdit = (role: Role | null) => role === 'admin' || role === 'hr'

interface UiState {
  theme: string
  mode: 'light' | 'dark'
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  setTheme: (t: string) => void
  setMode: (m: 'light' | 'dark') => void
  toggleSidebar: (v?: boolean) => void
  toggleCollapsed: (v?: boolean) => void
}

export const useUi = create<UiState>()((set) => ({
  theme: localStorage.getItem('faceid-theme') || 'arctic',
  mode: (localStorage.getItem('faceid-theme-mode') as 'light' | 'dark') || 'light',
  sidebarOpen: false,
  sidebarCollapsed: localStorage.getItem('faceid-sidebar') === 'collapsed',
  setTheme: (theme) => {
    localStorage.setItem('faceid-theme', theme)
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  setMode: (mode) => {
    localStorage.setItem('faceid-theme-mode', mode)
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(mode)
    set({ mode })
  },
  toggleSidebar: (v) => set((s) => ({ sidebarOpen: v ?? !s.sidebarOpen })),
  toggleCollapsed: (v) => set((s) => { const next = v ?? !s.sidebarCollapsed; localStorage.setItem('faceid-sidebar', next ? 'collapsed' : 'open'); return { sidebarCollapsed: next } }),
}))
