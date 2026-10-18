import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DropdownChevron } from './DropdownChevron'
import './filter-disclosure.css'

/** 三个阅读页面共用折叠壳，条件和请求逻辑仍由各页面负责。 */
export function FilterDisclosure({ title, activeCount, canClear = activeCount > 0, onClear, toolbar, children }: {
  title: string
  activeCount: number
  canClear?: boolean
  onClear: () => void
  toolbar?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    // Portal 不在面板 DOM 内，收起前主动关闭，防止下拉悬留在页面上。
    window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: id }))
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    // 下拉会在捕获阶段先消费 Escape；没有下拉时才收起筛选。
    if (open && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      close()
    }
  }
  return <>
    <header className="filter-disclosure__header" onKeyDown={onKeyDown}>
      <h2>{title}</h2>
      <div className="filter-disclosure__actions">
        <button ref={trigger} type="button" className="secondary-button filter-disclosure__toggle" aria-label="筛选" aria-expanded={open} aria-controls={`${id}-panel`} aria-describedby={activeCount > 0 ? `${id}-count` : undefined} onClick={() => open ? close() : setOpen(true)}>
          <span>筛选</span>{activeCount > 0 && <><span className="filter-disclosure__count" aria-hidden="true">{activeCount}</span><span id={`${id}-count`} className="sr-only">{activeCount} 项筛选条件</span></>}<DropdownChevron open={open} />
        </button>
        {canClear && <button type="button" className="secondary-button filter-disclosure__clear" aria-label="清除筛选" title="清除筛选" onClick={() => { trigger.current?.focus({ preventScroll: true }); onClear() }}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>}
      </div>
    </header>
    {toolbar}
    {/* 常驻控件只隐藏不卸载，保留草稿；hidden 同时移出键盘和读屏顺序。 */}
    <div id={`${id}-panel`} className="filter-disclosure__panel" role="region" aria-label={`${title}筛选`} hidden={!open} onKeyDown={onKeyDown}>{children}</div>
  </>
}
