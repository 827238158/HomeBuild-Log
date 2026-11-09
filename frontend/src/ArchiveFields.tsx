import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { createEntity, createSpace, type EntityType } from './domainApi'
import { DropdownChevron } from './DropdownChevron'
import { HttpError } from './http'
import { useDropdown } from './useDropdown'
import { useDropdownPosition } from './useDropdownPosition'
import { useModalFocus } from './useModalFocus'
import './ArchiveFields.css'

export type ArchiveType = EntityType | 'spaces'
export interface ArchiveItem { id: string; name: string; [key: string]: unknown }

export const archiveLabels: Record<ArchiveType, string> = {
  vendors: '商家', materials: '材料', participants: '参与人', spaces: '空间', stages: '装修阶段',
}

const spaceKinds = { house: '房屋', room: '房间', component: '局部构件', surface: '表面' }
const materialFields = { brand: '品牌', model: '型号', color: '颜色', finish: '表面处理' }
const archiveCreated = 'homebuild:archive-created'

export function subscribeArchiveCreated(listener: (type: ArchiveType, item: ArchiveItem) => void) {
  const receive = (event: Event) => {
    const { type, item } = (event as CustomEvent<{ type: ArchiveType; item: ArchiveItem }>).detail
    listener(type, item)
  }
  window.addEventListener(archiveCreated, receive)
  return () => window.removeEventListener(archiveCreated, receive)
}

export function normalizeArchiveText(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : ''
}

function spacePath(item: ArchiveItem, spaces: ArchiveItem[]) {
  const names = [item.name]
  const visited = new Set([item.id])
  let parent = spaces.find(space => space.id === item.parent_id)
  while (parent && !visited.has(parent.id)) {
    names.unshift(parent.name)
    visited.add(parent.id)
    const parentId = parent.parent_id
    parent = spaces.find(space => space.id === parentId)
  }
  return names.join(' / ')
}

export function archiveItemLabel(type: ArchiveType, item: ArchiveItem, spaces: ArchiveItem[] = []) {
  if (type === 'spaces') return spacePath(item, spaces)
  const fields = type === 'materials' ? Object.keys(materialFields) : type === 'participants' ? ['role', 'contact'] : type === 'vendors' ? ['contact'] : []
  return [item.name, ...fields.map(key => item[key]).filter(Boolean)].join(' · ')
}

export function archiveSearchText(type: ArchiveType, item: ArchiveItem, spaces: ArchiveItem[] = []) {
  return normalizeArchiveText(archiveItemLabel(type, item, spaces))
}

function conflictItems(reason: unknown): ArchiveItem[] {
  if (!(reason instanceof HttpError) || reason.code !== 'archive_duplicate') return []
  const matches = (reason.detail as { matches?: ArchiveItem[] } | undefined)?.matches
  return Array.isArray(matches) ? matches : []
}

export function ArchiveCreate({ type, options, spaces = options, initialName = '', onCreated, onMatch, onCancel, onBusyChange }: {
  type: ArchiveType; options: ArchiveItem[]; spaces?: ArchiveItem[]; initialName?: string
  onCreated: (item: ArchiveItem) => void; onMatch?: (item: ArchiveItem) => void; onCancel: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<keyof typeof spaceKinds>('room')
  const [parentId, setParentId] = useState('')
  const [details, setDetails] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [matches, setMatches] = useState<ArchiveItem[]>([])
  const submitting = useRef(false)
  const fields = type === 'materials' ? materialFields : type === 'participants' ? { role: '角色', contact: '联系方式' } : type === 'vendors' ? { contact: '联系方式' } : {}
  const sameName = normalizeArchiveText(name) ? options.filter(item => normalizeArchiveText(item.name) === normalizeArchiveText(name)) : []
  const existing = matches.length ? matches : sameName
  const label = archiveLabels[type]

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (submitting.current) return
    if (!normalizeArchiveText(name)) { setError('请输入档案名称。'); return }
    submitting.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setMatches([])
    let item: ArchiveItem
    try {
      item = type === 'spaces'
        ? { ...await createSpace({ name, kind, parent_id: kind === 'house' ? null : parentId }) }
        : await createEntity(type, { name, ...details })
    } catch (reason) {
      const duplicates = conflictItems(reason)
      setMatches(duplicates)
      setError(duplicates.length ? '已存在相同档案，请选用已有项或修改输入。' : reason instanceof HttpError ? reason.message : '保存档案失败，请重试。')
      return
    } finally {
      submitting.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
    // 档案独立保存，通知当前页面已挂载的同类选择器更新选项。
    window.dispatchEvent(new CustomEvent(archiveCreated, { detail: { type, item } }))
    onCreated(item)
  }

  const revise = () => { setError(''); setMatches([]) }
  return <form className="archive-create" onSubmit={submit}>
    <label className="field-stack"><span>{label}名称</span><input required maxLength={200} value={name} disabled={busy} onChange={event => { setName(event.target.value); revise() }} /></label>
    {type === 'spaces' && <div className="archive-create__details">
      <label className="field-stack"><span>空间类型</span><select value={kind} disabled={busy} onChange={event => { setKind(event.target.value as keyof typeof spaceKinds); revise() }}>{Object.entries(spaceKinds).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      {kind !== 'house' && <label className="field-stack"><span>上级空间</span><select required value={parentId} disabled={busy} onChange={event => { setParentId(event.target.value); revise() }}><option value="">请选择上级空间</option>{spaces.map(space => <option key={space.id} value={space.id}>{spacePath(space, spaces)}</option>)}</select></label>}
    </div>}
    {Object.keys(fields).length > 0 && <div className="archive-create__details">{Object.entries(fields).map(([key, text]) => <label className="field-stack" key={key}><span>{text}（可选）</span><input value={details[key] ?? ''} disabled={busy} onChange={event => { setDetails({ ...details, [key]: event.target.value }); revise() }} /></label>)}</div>}
    {error && <p role="alert">{error}</p>}
    {existing.length > 0 && <div className="archive-create__matches">
      <p>{matches.length ? '匹配的档案' : '已有同名档案'}</p>
      <ul>{existing.map(item => <li key={item.id}>{onMatch
        ? <button type="button" className="secondary-button" disabled={busy} onClick={() => onMatch(item)}>{archiveItemLabel(type, item, spaces)}</button>
        : archiveItemLabel(type, item, spaces)}</li>)}</ul>
    </div>}
    <div className="archive-create__actions">
      <button className="primary-button" type="submit" disabled={busy}>{busy ? '保存中…' : `新增${label}`}</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>取消</button>
    </div>
  </form>
}

function ArchiveDialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: (setBusy: (busy: boolean) => void) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  useModalFocus(ref, true, () => { if (!busy) onClose() })
  return createPortal(<div className="archive-dialog-backdrop" data-modal-backdrop>
    <div ref={ref} className="archive-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
      <h3 id={id}>{title}</h3>
      {children(setBusy)}
    </div>
  </div>, document.body)
}

export function ArchivePicker({ type, label, options, spaces, value, onChange, disabled = false, required = false }: {
  type: ArchiveType; label: string; options: ArchiveItem[]; spaces?: ArchiveItem[]
  value: string | string[]; onChange: (ids: string[]) => void; disabled?: boolean; required?: boolean
}) {
  const multi = Array.isArray(value)
  const selectedIds = Array.isArray(value) ? value : value ? [value] : []
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState<string | null>(null)
  const [added, setAdded] = useState<ArchiveItem[]>([])
  const [invalid, setInvalid] = useState(false)
  const { id, open, toggleMenu, openMenu, closeMenu, focusTrigger } = useDropdown({ rootRef, triggerRef, menuRef, disabled })
  const style = useDropdownPosition(triggerRef, open, 320, 240)
  const all = [...options, ...added.filter(item => !options.some(option => option.id === item.id))]
  const hierarchy = type === 'spaces' ? all : spaces
  const selected = all.filter(item => selectedIds.includes(item.id))
  const summary = selectedIds.length === 0 ? (multi ? '请选择（可多选）' : type === 'stages' ? '未选择' : '请选择') :
    selected.length === selectedIds.length && selected.length <= 2 ? selected.map(item => archiveItemLabel(type, item, hierarchy)).join('、') :
      multi ? `已选择 ${selectedIds.length} 项` : '已选档案'
  const filtered = all.filter(item => archiveSearchText(type, item, hierarchy).includes(normalizeArchiveText(query)))

  useEffect(() => subscribeArchiveCreated((category, item) => {
    if (category === type) setAdded(items => [...items.filter(option => option.id !== item.id), item])
  }), [type])
  useEffect(() => { if (open) searchRef.current?.focus({ preventScroll: true }); else setQuery('') }, [open])
  useEffect(() => { if (selectedIds.length) setInvalid(false) }, [selectedIds.length])

  const pick = (item: ArchiveItem) => {
    if (!options.some(option => option.id === item.id)) {
      setAdded(items => items.some(option => option.id === item.id) ? items : [...items, item])
    }
    onChange(multi ? [...new Set([...selectedIds, item.id])] : [item.id])
    setNewName(null)
    closeMenu(true)
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const controls = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('input, button') ?? [])
    if (event.key === 'Enter' && event.target === searchRef.current) {
      event.preventDefault()
      return
    }
    // 抽屉已有完整 Tab 顺序。普通页面则从菜单末端回到触发器所在的表单顺序。
    if (event.key === 'Tab' && !triggerRef.current?.closest('[aria-modal="true"]')) {
      if (event.shiftKey && event.target === controls[0]) {
        event.preventDefault()
        closeMenu(true)
      } else if (!event.shiftKey && event.target === controls.at(-1)) {
        closeMenu(true)
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const index = controls.indexOf(document.activeElement as HTMLElement)
    const next = Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    event.preventDefault()
    controls[next]?.focus()
  }

  return <fieldset ref={rootRef} className="multi-select-field archive-picker" disabled={disabled}>
    <legend>{label}{required && <span className="record-associations__required">（必填）</span>}</legend>
    <div className="multi-select-control">
      {!multi && <select className="select-native-proxy" tabIndex={-1} aria-hidden="true" aria-label={label} disabled={disabled} required={required} value={value as string} onFocus={focusTrigger} onChange={event => onChange(event.target.value ? [event.target.value] : [])} onInvalid={event => { event.preventDefault(); setInvalid(true); focusTrigger() }}>
        <option value="">请选择</option>
        {all.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {value && selected.length === 0 && <option value={value as string}>已选档案</option>}
      </select>}
      <button ref={triggerRef} type="button" role={multi ? undefined : 'combobox'} className={multi ? 'multi-select-summary' : 'select-trigger'} disabled={disabled} aria-label={`${label}：${summary}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-disabled={disabled} aria-required={multi ? undefined : required} aria-invalid={invalid || undefined} onClick={toggleMenu} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu() }
      }}><span>{summary}</span><DropdownChevron open={open} /></button>
      {invalid && <small role="alert">请选择{label}。</small>}
    </div>
    {open && createPortal(<div ref={menuRef} className="multi-select-options dropdown-portal association-options archive-picker__menu" style={style} onKeyDown={onMenuKeyDown}>
      <input ref={searchRef} type="search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={query} onChange={event => setQuery(event.target.value)} />
      <div id={`${id}-options`} role="listbox" aria-label={label} aria-multiselectable={multi || undefined} aria-required={required || undefined} className="archive-picker__list">
        {!multi && (type === 'stages' || (!required && value)) && <button type="button" role="option" aria-selected={false} onClick={() => { onChange([]); closeMenu(true) }}>{type === 'stages' ? '未选择' : '清除选择'}</button>}
        {filtered.map(item => multi
          ? <label key={item.id} role="option" aria-selected={selectedIds.includes(item.id)}><input type="checkbox" aria-label={item.name} aria-description={archiveItemLabel(type, item, hierarchy)} checked={selectedIds.includes(item.id)} onChange={() => selectedIds.includes(item.id) ? onChange(selectedIds.filter(value => value !== item.id)) : onChange([...selectedIds, item.id])} /><span className="multi-select-option__name">{archiveItemLabel(type, item, hierarchy)}</span></label>
          : <button key={item.id} type="button" role="option" aria-selected={selectedIds.includes(item.id)} onClick={() => pick(item)}>{archiveItemLabel(type, item, hierarchy)}</button>)}
      </div>
      {!filtered.length && <p>{query ? '没有匹配的档案' : '暂无可选档案'}</p>}
      <button className="secondary-button archive-picker__add" type="button" onClick={() => { setNewName(query); closeMenu(true) }}>新增{archiveLabels[type]}</button>
    </div>, document.body)}
    {newName !== null && <ArchiveDialog title={`新增${archiveLabels[type]}`} onClose={() => setNewName(null)}>
      {setBusy => <ArchiveCreate type={type} initialName={newName} options={all} spaces={hierarchy} onCreated={pick} onMatch={item => {
        if (!all.some(option => option.id === item.id)) {
          window.dispatchEvent(new CustomEvent(archiveCreated, { detail: { type, item } }))
        }
        pick(item)
      }} onCancel={() => setNewName(null)} onBusyChange={setBusy} />}
    </ArchiveDialog>}
  </fieldset>
}
