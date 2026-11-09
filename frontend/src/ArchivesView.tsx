import { useEffect, useRef, useState } from 'react'
import {
  ArchiveCreate, archiveItemLabel, archiveLabels, archiveSearchText, normalizeArchiveText,
  type ArchiveItem, type ArchiveType,
} from './ArchiveFields'
import { deleteEntity, deleteSpace, listEntities, listSpaces } from './domainApi'
import { useNavigationGuard } from './navigationGuard'
import './archives-view.css'

const categories: ArchiveType[] = ['vendors', 'materials', 'participants', 'spaces', 'stages']

export function ArchivesView({ initialType }: { initialType: ArchiveType }) {
  const [type, setType] = useState(initialType)
  const [items, setItems] = useState<ArchiveItem[]>([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [revision, setRevision] = useState(0)
  const [locatedId, setLocatedId] = useState('')
  const locatedRow = useRef<HTMLLIElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const createArea = useRef<HTMLDivElement>(null)
  const label = archiveLabels[type]
  useNavigationGuard(creating)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    const load = type === 'spaces' ? listSpaces() : listEntities(type)
    load.then((rows) => { if (active) setItems(rows ?? []) })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : `${label}加载失败。`)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [type, label, revision])

  useEffect(() => {
    if (locatedId && !loading) locatedRow.current?.focus()
  }, [locatedId, loading])

  useEffect(() => {
    if (creating) createArea.current?.querySelector('input')?.focus()
  }, [creating])

  const spaces = type === 'spaces' ? items : undefined
  const rootCount = spaces?.filter(item => item.kind === 'house' && item.parent_id == null).length ?? 0
  const parentIds = new Set(spaces?.map(item => item.parent_id))
  const search = normalizeArchiveText(query).split(' ').filter(Boolean)
  const visible = items.filter(item => {
    const searchable = archiveSearchText(type, item, spaces)
    return search.every(word => searchable.includes(word))
  })

  function switchType(next: ArchiveType) {
    if (next === type) return
    setType(next)
    setItems([])
    setQuery('')
    setLocatedId('')
    setFeedback('')
    setActionError('')
    setLoading(true)
  }

  function locate(item: ArchiveItem, created: boolean) {
    // 冲突项可能是其他表单刚添加的，重新读取列表与重复标记。
    setItems(current => current.some(row => row.id === item.id) ? current : [...current, item])
    setRevision(value => value + 1)
    setCreating(false)
    setQuery('')
    setLocatedId(item.id)
    setFeedback(created ? `${label}“${item.name}”已新增。` : `已定位到现有${label}“${item.name}”。`)
  }

  async function remove(item: ArchiveItem) {
    if (deleting || !window.confirm(`确认永久删除${label}“${item.name}”吗？此操作无法恢复。`)) return
    setDeleting(true)
    setActionError('')
    setFeedback('')
    try {
      if (type === 'spaces') await deleteSpace(item.id)
      else await deleteEntity(type, item.id)
      setItems(current => current.filter(row => row.id !== item.id))
      setRevision(value => value + 1)
      setLocatedId('')
      setFeedback(`${label}“${item.name}”已删除。`)
    } catch (reason: unknown) {
      setActionError(reason instanceof Error ? reason.message : `删除${label}失败。`)
    } finally {
      setDeleting(false)
    }
  }

  return <section className="view-panel archives-view" aria-labelledby="archives-title">
    <header>
      <h2 id="archives-title">装修档案</h2>
      <button ref={addButton} type="button" className="primary-button" disabled={creating || loading || !!loadError || deleting} onClick={() => {
        setCreating(true)
        setActionError('')
        setFeedback('')
        setLocatedId('')
      }}>新增{label}</button>
    </header>
    <div className="archives-view__categories" role="group" aria-label="档案分类">
      {categories.map(category => <button key={category} type="button" className="secondary-button" aria-pressed={category === type}
        disabled={creating || deleting} onClick={() => switchType(category)}>{archiveLabels[category]}</button>)}
    </div>
    {creating && <div ref={createArea}><ArchiveCreate type={type} options={items} spaces={spaces} initialName={query.trim()}
      onCreated={item => locate(item, true)} onMatch={item => locate(item, false)}
      onCancel={() => { setCreating(false); requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true })) }} /></div>}
    <div className="archives-view__tools">
      <label className="field-stack">
        <span>搜索{label}</span>
        <input type="search" value={query} disabled={creating} onChange={event => { setQuery(event.target.value); setLocatedId('') }} />
      </label>
      {!loading && !loadError && <span className="muted">{visible.length} 项</span>}
    </div>
    {feedback && <p role="status">{feedback}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {loading && <p role="status">正在加载{label}…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}>重试</button></div>}
    {(items.length > 0 || (!loading && !loadError)) && (visible.length ? <ul className="archives-view__list" aria-label={`已有${label}`}>
      {visible.map(item => {
        const systemRoot = rootCount === 1 && item.kind === 'house' && item.parent_id == null
        const hasChildren = parentIds.has(item.id)
        const itemLabel = archiveItemLabel(type, item, spaces)
        const located = item.id === locatedId
        return <li key={item.id} ref={located ? locatedRow : undefined} tabIndex={located ? -1 : undefined}
          className={located ? 'archives-view__located' : undefined}>
          <div><strong>{itemLabel}</strong>{item.duplicate === true && <small className="archives-view__duplicate">历史重复</small>}</div>
          {systemRoot ? <small className="muted">系统根空间不可删除</small> : hasChildren ? <small className="muted">含下级空间，无法删除</small>
            : <button type="button" className="danger-button" aria-label={`删除${itemLabel}`} disabled={deleting || creating || loading || !!loadError} onClick={() => void remove(item)}>删除</button>}
        </li>
      })}
    </ul> : <p className="muted">{search.length ? `没有找到匹配的${label}。` : `还没有${label}。`}</p>)}
  </section>
}
