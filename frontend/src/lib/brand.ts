/** Brand colour: one hex from settings drives --accent / --accent-hover / --accent-soft for the whole UI. */

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const darken = (rgb: [number, number, number], k: number) => toHex(rgb[0] * (1 - k), rgb[1] * (1 - k), rgb[2] * (1 - k))

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v.trim())

export function applyBrandColor(hex: string | null | undefined) {
  const root = document.documentElement
  const rgb = hex ? hexToRgb(hex) : null
  if (!rgb) {
    root.style.removeProperty('--accent'); root.style.removeProperty('--accent-hover'); root.style.removeProperty('--accent-soft')
    return
  }
  root.style.setProperty('--accent', toHex(...rgb))
  root.style.setProperty('--accent-hover', darken(rgb, 0.16))
}

export const BRAND_PRESETS: { name: string; hex: string }[] = [
  { name: 'Indigo', hex: '#2f5bea' }, { name: 'Royal', hex: '#4f46e5' }, { name: 'Ocean', hex: '#0284c7' }, { name: 'Teal', hex: '#0f9d8a' },
  { name: 'Emerald', hex: '#16a34a' }, { name: 'Amber', hex: '#d97706' }, { name: 'Coral', hex: '#e2542c' }, { name: 'Rose', hex: '#e11d48' },
  { name: 'Violet', hex: '#7c3aed' }, { name: 'Graphite', hex: '#334155' },
]
