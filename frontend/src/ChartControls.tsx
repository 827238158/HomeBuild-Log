import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDropdown } from './useDropdown'
import { useDropdownPosition } from './useDropdownPosition'
import './chart-controls.css'

interface ChartControlsProps {
  title: string
  items?: Array<{ key: string; label: string }>
  selectedKey?: string
  active: boolean
  onChoose: (key: string) => void
  onClear: () => void
}

export function ChartControls({ title, items = [], selectedKey, active, onChoose, onClear }: ChartControlsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { id, open, closeMenu, toggleMenu } = useDropdown({ rootRef, triggerRef, menuRef })
  const menuStyle = useDropdownPosition(triggerRef, open, 280, 200)

  useEffect(() => {
    if (!open) return
    // 聚焦只作用于菜单，避免长页面因打开分类而跳动。
    const target = menuRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?? menuRef.current?.querySelector<HTMLButtonElement>('button')
    target?.focus({ preventScroll: true })
  }, [open])

  const handleBlur = (target: EventTarget | null) => {
    if (!rootRef.current?.contains(target as Node) && !menuRef.current?.contains(target as Node)) closeMenu()
  }

  return <div ref={rootRef} tabIndex={-1} className="chart-controls" onBlur={event => handleBlur(event.relatedTarget)}>
    {/* 清除按钮保留布局槽位；不可见时不进入键盘顺序或可访问树。 */}
    <button type="button" className="chart-icon-button chart-clear" style={{ visibility: active ? 'visible' : 'hidden' }} tabIndex={active ? 0 : -1} aria-hidden={!active} aria-label={`清除${title}筛选`} onClick={() => {
      (triggerRef.current ?? rootRef.current)?.focus({ preventScroll: true })
      onClear()
    }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>
    {items.length > 0 && <button ref={triggerRef} type="button" className="chart-icon-button" aria-label={`${title}分类`} aria-expanded={open} aria-controls={open ? `${id}-categories` : undefined} onClick={toggleMenu}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg></button>}
    {open && createPortal(<div ref={menuRef} id={`${id}-categories`} className="chart-category-menu dropdown-portal" style={menuStyle} role="group" aria-label={`${title}分类`} onBlur={event => handleBlur(event.relatedTarget)} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus({ preventScroll: true })
      // 菜单内部滚动，不触发页面祖先的 scrollIntoView。
      const button = buttons[next]
      const menu = menuRef.current
      if (button && menu) {
        if (button.offsetTop < menu.scrollTop) menu.scrollTop = button.offsetTop
        else if (button.offsetTop + button.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = button.offsetTop + button.offsetHeight - menu.clientHeight
      }
    }}>{items.map(item => <button key={item.key} type="button" aria-pressed={selectedKey === undefined ? undefined : selectedKey === item.key} onClick={() => {
      closeMenu(true)
      onChoose(item.key)
    }}><span>{item.label}</span>{selectedKey === item.key && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}</button>)}</div>, document.body)}
  </div>
}
