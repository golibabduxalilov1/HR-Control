import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tr } from '@/i18n'
import { Building2, Briefcase, ChevronRight, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import { Confirm, Empty, Field, Modal, Select, Spinner, useToast } from '@/components/ui'
import { useAuth } from '@/store/auth'

type Dep = { id: number; name: string; parent_id: number | null; employee_count: number; children?: Dep[] }
type Pos = { id: number; name: string; department_id: number | null; department_name: string | null; employee_count: number }

export function StructurePage({ embedded }: { embedded?: boolean } = {}) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const isAdmin = role === 'admin'
  const [depName, setDepName] = useState('')
  const [depParent, setDepParent] = useState<number | null>(null)
  const [posName, setPosName] = useState('')
  const [posDep, setPosDep] = useState<number | null>(null)
  const [editDep, setEditDep] = useState<Dep | null>(null)
  const [editPos, setEditPos] = useState<Pos | null>(null)
  const [assign, setAssign] = useState<{ kind: 'dep' | 'pos'; id: number; name: string } | null>(null)
  const [del, setDel] = useState<{ kind: 'dep' | 'pos'; id: number; name: string } | null>(null)

  const tree = useQuery({ queryKey: ['dep-tree'], queryFn: async () => (await api.get('/departments/tree')).data as Dep[] })
  const deps = useQuery({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data as Dep[] })
  const positions = useQuery({ queryKey: ['positions'], queryFn: async () => (await api.get('/positions')).data as Pos[] })
  const inv = () => qc.invalidateQueries()
  const err = (e: unknown) => toast.push(errorMessage(e), 'error')
  const addDep = useMutation({ mutationFn: async () => api.post('/departments', { name: depName, parent_id: depParent }), onSuccess: () => { toast.push(tr("Подразделение добавлено")); setDepName(''); inv() }, onError: err })
  const saveDep = useMutation({ mutationFn: async (d: Dep) => api.patch(`/departments/${d.id}`, { name: d.name, parent_id: d.parent_id }), onSuccess: () => { toast.push(tr("Сохранено")); setEditDep(null); inv() }, onError: err })
  const addPos = useMutation({ mutationFn: async () => api.post('/positions', { name: posName, department_id: posDep }), onSuccess: () => { toast.push(tr("Должность добавлена")); setPosName(''); inv() }, onError: err })
  const savePos = useMutation({ mutationFn: async (p: Pos) => api.patch(`/positions/${p.id}`, { name: p.name, department_id: p.department_id }), onSuccess: () => { toast.push(tr("Сохранено")); setEditPos(null); inv() }, onError: err })
  const remove = useMutation({ mutationFn: async (d: { kind: string; id: number }) => api.delete(`/${d.kind === 'dep' ? 'departments' : 'positions'}/${d.id}`), onSuccess: () => { toast.push(tr("Удалено")); setDel(null); inv() }, onError: err })

  const flat = (nodes: Dep[], depth = 0): (Dep & { depth: number })[] => nodes.flatMap((n) => [{ ...n, depth }, ...flat(n.children ?? [], depth + 1)])
  const rows = flat(tree.data ?? [])
  const depOpts = [{ value: null as number | null, label: tr("Без родителя") }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]

  return (
    <div className="space-y-4 animate-fade-in">
      {!embedded && <div><h1 className="text-lg font-semibold">{tr("Структура")}</h1><p className="text-sm text-muted">{tr("Организационная структура компании")}</p></div>}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          {isAdmin && <div className="card p-4">
            <div className="flex items-center gap-2 mb-3"><div><div className="font-semibold text-sm">{tr("Добавить подразделение")}</div><div className="text-xs text-muted">{tr("Укажите название и родительский отдел")}</div></div></div>
            <div className="flex flex-wrap gap-2"><input className="input flex-1 min-w-40" placeholder={tr("Название")} value={depName} onChange={(e) => setDepName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && depName && addDep.mutate()} /><Select className="w-48" value={depParent} onChange={setDepParent} options={depOpts} /><button className="btn-primary" disabled={!depName.trim() || addDep.isPending} onClick={() => addDep.mutate()}><Plus className="h-4 w-4" />{tr("Добавить")}</button></div>
          </div>}
          <div className="card overflow-hidden">
            <table className="table"><thead><tr><th>{tr("Подразделение")}</th><th className="text-center">{tr("Сотрудников")}</th><th>{tr("Родитель")}</th>{isAdmin && <th />}</tr></thead><tbody>
              {rows.map((d) => (
                <tr key={d.id}><td><div className="flex items-center gap-1 font-medium" style={{ paddingLeft: d.depth * 16 }}>{d.depth > 0 && <ChevronRight className="h-3 w-3 text-subtle" />}{d.name}</div></td><td className="text-center"><span className="tabular-nums">{d.employee_count}</span></td><td className="text-muted">{deps.data?.find((x) => x.id === d.parent_id)?.name ?? '—'}</td>
                  {isAdmin && <td className="text-right whitespace-nowrap"><button className="btn-ghost btn-sm" title={tr("Перевести сотрудников")} onClick={() => setAssign({ kind: 'dep', id: d.id, name: d.name })}><Users className="h-4 w-4" /></button><button className="btn-ghost btn-sm" title={tr("Редактировать")} onClick={() => setEditDep(d)}><Pencil className="h-4 w-4" /></button><button className="btn-ghost btn-sm text-danger" title={tr("Удалить")} onClick={() => setDel({ kind: 'dep', id: d.id, name: d.name })}><Trash2 className="h-4 w-4" /></button></td>}</tr>
              ))}
            </tbody></table>{tree.isLoading ? <Spinner /> : !rows.length && <Empty text={tr("Подразделений пока нет")} />}
          </div>
        </div>
        <div className="space-y-3">
          {isAdmin && <div className="card p-4">
            <div className="flex items-center gap-2 mb-3"><div><div className="font-semibold text-sm">{tr("Добавить должность")}</div><div className="text-xs text-muted">{tr("Укажите название и подразделение")}</div></div></div>
            <div className="flex flex-wrap gap-2"><input className="input flex-1 min-w-40" placeholder={tr("Название должности")} value={posName} onChange={(e) => setPosName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && posName && addPos.mutate()} /><Select className="w-48" value={posDep} onChange={setPosDep} placeholder={tr("Выберите подразделение")} options={[{ value: null, label: tr("Без подразделения") }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} /><button className="btn-primary" disabled={!posName.trim() || addPos.isPending} onClick={() => addPos.mutate()}><Plus className="h-4 w-4" />{tr("Добавить")}</button></div>
          </div>}
          <div className="card overflow-hidden">
            <table className="table"><thead><tr><th>{tr("Должность")}</th><th>{tr("Подразделение")}</th><th className="text-center">{tr("Сотрудников")}</th>{isAdmin && <th />}</tr></thead><tbody>
              {(positions.data ?? []).map((p) => (
                <tr key={p.id}><td className="font-medium">{p.name}</td><td className="text-muted">{p.department_name ?? '—'}</td><td className="text-center"><span className="tabular-nums">{p.employee_count}</span></td>
                  {isAdmin && <td className="text-right whitespace-nowrap"><button className="btn-ghost btn-sm" title={tr("Назначить сотрудников")} onClick={() => setAssign({ kind: 'pos', id: p.id, name: p.name })}><Users className="h-4 w-4" /></button><button className="btn-ghost btn-sm" onClick={() => setEditPos(p)}><Pencil className="h-4 w-4" /></button><button className="btn-ghost btn-sm text-danger" onClick={() => setDel({ kind: 'pos', id: p.id, name: p.name })}><Trash2 className="h-4 w-4" /></button></td>}</tr>
              ))}
            </tbody></table>{positions.isLoading ? <Spinner /> : !positions.data?.length && <Empty text={tr("Должностей пока нет")} />}
          </div>
        </div>
      </div>
      {editDep && <Modal open onClose={() => setEditDep(null)} title={tr("Редактировать подразделение")} size="sm" footer={<><button className="btn-secondary" onClick={() => setEditDep(null)}>{tr("Отмена")}</button><button className="btn-primary" onClick={() => saveDep.mutate(editDep)}>{tr("Сохранить")}</button></>}>
        <div className="space-y-3"><Field label={tr("Название")}><input className="input" value={editDep.name} onChange={(e) => setEditDep({ ...editDep, name: e.target.value })} /></Field><Field label={tr("Родитель")}><Select value={editDep.parent_id} onChange={(v) => setEditDep({ ...editDep, parent_id: v })} options={depOpts.filter((o) => o.value !== editDep.id)} /></Field></div></Modal>}
      {editPos && <Modal open onClose={() => setEditPos(null)} title={tr("Редактировать должность")} size="sm" footer={<><button className="btn-secondary" onClick={() => setEditPos(null)}>{tr("Отмена")}</button><button className="btn-primary" onClick={() => savePos.mutate(editPos)}>{tr("Сохранить")}</button></>}>
        <div className="space-y-3"><Field label={tr("Название")}><input className="input" value={editPos.name} onChange={(e) => setEditPos({ ...editPos, name: e.target.value })} /></Field><Field label={tr("Подразделение")}><Select value={editPos.department_id} onChange={(v) => setEditPos({ ...editPos, department_id: v })} options={[{ value: null, label: tr("Без подразделения") }, ...(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} /></Field></div></Modal>}
      {assign && <AssignModal target={assign} onClose={() => setAssign(null)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title={tr("Удалить «{{v0}}»?", { v0: del?.name })} text={tr("Сотрудники останутся, но будут отвязаны.")} danger loading={remove.isPending} />
    </div>
  )
}

export function AssignModal({ target, onClose }: { target: { kind: 'dep' | 'pos' | 'schedule' | 'branch'; id: number; name: string }; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const emps = useQuery({ queryKey: ['employees-all'], queryFn: async () => (await api.get('/employees?per_page=500&status=active')).data.items as { id: number; full_name: string; department_name: string | null; position_name: string | null; schedule_name: string | null }[] })
  const url = { dep: `/departments/${target.id}/assign-employees`, pos: `/positions/${target.id}/assign-employees`, schedule: `/schedules/${target.id}/assign`, branch: `/branches/${target.id}/assign-employees` }[target.kind]
  const m = useMutation({ mutationFn: async () => api.post(url, { employee_ids: [...selected] }), onSuccess: () => { toast.push(tr("Назначено: {{v0}}", { v0: selected.size })); qc.invalidateQueries(); onClose() }, onError: (e) => toast.push(errorMessage(e), 'error') })
  const items = (emps.data ?? []).filter((e) => !q || e.full_name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal open onClose={onClose} title={tr("Назначить сотрудников → {{v0}}", { v0: target.name })} size="md" footer={<><button className="btn-secondary" onClick={onClose}>{tr("Отмена")}</button><button className="btn-primary" disabled={!selected.size || m.isPending} onClick={() => m.mutate()}>{tr("Назначить (")}{selected.size})</button></>}>
      <input className="input mb-2" placeholder={tr("Поиск...")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2 mb-2 text-xs"><button className="btn-ghost btn-sm" onClick={() => setSelected(new Set(items.map((e) => e.id)))}>{tr("Выбрать видимых")}</button><button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>{tr("Сбросить")}</button></div>
      <div className="max-h-80 overflow-auto divide-y divide-line">{items.map((e) => (
        <label key={e.id} className="flex items-center gap-3 py-2 cursor-pointer"><input type="checkbox" checked={selected.has(e.id)} onChange={(ev) => { const s = new Set(selected); ev.target.checked ? s.add(e.id) : s.delete(e.id); setSelected(s) }} /><div className="min-w-0"><div className="text-sm font-medium">{e.full_name}</div><div className="text-xs text-muted">{[e.position_name, e.department_name, target.kind === 'schedule' ? e.schedule_name : null].filter(Boolean).join(' · ') || '—'}</div></div></label>
      ))}</div>
    </Modal>
  )
}
