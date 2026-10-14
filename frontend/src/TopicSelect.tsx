import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listTopics, type Topic } from './topicsApi'
import { useDropdown } from './useDropdown'
import { useDropdownPosition } from './useDropdownPosition'
import { DropdownChevron } from './DropdownChevron'

export function TopicSelect({ value, onChange, disabled = false, label = '所属主题（可选）' }: {
  value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label?: string
}) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const rootRef = useRef<HTMLFieldSetElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { id, open, toggleMenu } = useDropdown({ rootRef, triggerRef, menuRef, disabled })
  const style = useDropdownPosition(triggerRef, open)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    listTopics().then(result => { if (active) setTopics(result.items) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '主题读取失败，请重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [retry])
  const selected = topics.filter(topic => value.includes(topic.id))
  const missing = value.some(id => !topics.some(topic => topic.id === id))
  const summary = value.length === 0 ? '请选择（可多选）' : missing ? `已选择 ${value.length} 个主题` : selected.length <= 2 ? selected.map(topic => topic.name).join('、') : `已选择 ${value.length} 个主题`
  return <fieldset ref={rootRef} className="multi-select-field" disabled={disabled}>
    <legend>{label}</legend>
    <div className="multi-select-control">
      <button ref={triggerRef} className="multi-select-summary" type="button" disabled={disabled} aria-label={`${label}：${summary}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-topics` : undefined} onPointerDown={event => event.preventDefault()} onClick={toggleMenu}>
        <span>{summary}</span><DropdownChevron open={open} />
      </button>
      {open && createPortal(<div ref={menuRef} id={`${id}-topics`} className="multi-select-options dropdown-portal" style={style} role="listbox" aria-multiselectable="true" aria-label={label}>
        {loading ? <span role="status">正在读取主题…</span> : error ? <div><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : topics.length === 0 ? <span>暂无主题，可在主题页面新建。</span> : topics.map(topic => {
          const checked = value.includes(topic.id)
          // 已归档的已有归属可以移除，但恢复前不可新增归属。
          return <label key={topic.id} role="option" aria-selected={checked} aria-disabled={topic.status === 'archived' && !checked}>
            <input type="checkbox" aria-label={topic.name} checked={checked} disabled={disabled || (topic.status === 'archived' && !checked)} onChange={() => onChange(checked ? value.filter(id => id !== topic.id) : [...value, topic.id])} />
            <span className="multi-select-option__name">{topic.name}</span>{topic.status === 'archived' && <span className="multi-select-option__meta">已归档</span>}
          </label>
        })}
      </div>, document.body)}
    </div>
  </fieldset>
}
