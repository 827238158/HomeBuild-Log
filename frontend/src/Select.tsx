import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDropdownPosition } from './useDropdownPosition'
import { useDropdown } from './useDropdown'
import { DropdownChevron } from './DropdownChevron'

interface OptionProps { value?: string; disabled?: boolean; children?: ReactNode }
interface SelectChange { target: { value: string } }

export interface SelectProps {
  value: string
  onChange: (event: SelectChange) => void
  children: ReactNode
  disabled?: boolean
  required?: boolean
  className?: string
  displayLabel?: string
  'aria-label'?: string
}

function optionText(node: ReactNode): string {
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('')
}

export function Select({ value, onChange, children, disabled, required, className, displayLabel, 'aria-label': ariaLabel }: SelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = Children.toArray(children).filter(isValidElement).map((node) => {
    const option = node as ReactElement<OptionProps>
    return { value: String(option.props.value ?? ''), label: option.props.children, disabled: option.props.disabled }
  })
  const { id, open, setOpen, openMenu, closeMenu, focusTrigger } = useDropdown({ rootRef, triggerRef, menuRef, disabled })
  const [accessibleLabel, setAccessibleLabel] = useState<string>()
  const [invalid, setInvalid] = useState(false)
  const [active, setActive] = useState(Math.max(0, options.findIndex((item) => item.value === value)))
  const searchRef = useRef({ text: '', time: 0 })
  const menuStyle = useDropdownPosition(triggerRef, open)
  const selected = options.find((item) => item.value === value)
  const selectedText = optionText(displayLabel ?? selected?.label ?? '请选择')
  const fieldLabel = ariaLabel ?? accessibleLabel
  const triggerLabel = fieldLabel ? `${fieldLabel}：${selectedText}` : selectedText

  useLayoutEffect(() => {
    const label = rootRef.current?.closest('label')
    const text = label?.querySelector(':scope > span')?.textContent?.trim()
    if (text) setAccessibleLabel(text)
    // 点击标签文字时直接聚焦可见入口，避免浏览器把隐藏校验代理滚入视口。
    const activateLabel = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      if (!disabled) focusTrigger()
    }
    label?.addEventListener('pointerdown', activateLabel)
    label?.addEventListener('click', activateLabel)
    return () => {
      label?.removeEventListener('pointerdown', activateLabel)
      label?.removeEventListener('click', activateLabel)
    }
  }, [disabled, focusTrigger])

  useEffect(() => { setInvalid(false) }, [value])
  useEffect(() => {
    // 只滚动菜单内部；scrollIntoView 会同时滚动页面和卡片祖先。
    const menu = menuRef.current
    const option = document.getElementById(`${id}-${active}`)
    if (!open || !menu || !option) return
    const menuRect = menu.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    const top = menuRect.top + menu.clientTop
    const bottom = top + menu.clientHeight
    if (optionRect.top < top) menu.scrollTop -= top - optionRect.top
    else if (optionRect.bottom > bottom) menu.scrollTop += optionRect.bottom - bottom
  }, [active, id, open])

  const showMenu = (nextActive?: number) => {
    const selectedIndex = options.findIndex((item) => item.value === value && !item.disabled)
    setActive(nextActive ?? (selectedIndex >= 0 ? selectedIndex : options.findIndex((item) => !item.disabled)))
    openMenu()
    searchRef.current.text = ''
  }
  const choose = (next: string) => { onChange({ target: { value: next } }); setInvalid(false); closeMenu(true) }
  const move = (step: number) => {
    if (!options.length) return
    let next = active
    for (let count = 0; count < options.length; count += 1) {
      next = (next + step + options.length) % options.length
      if (!options[next].disabled) { setActive(next); return }
    }
  }
  return <div ref={rootRef} className={`select-control${className ? ` ${className}` : ''}`}>
    {/* 原生控件只负责表单校验；可访问树与键盘入口由可见 combobox 统一提供。 */}
    <select className="select-native-proxy" tabIndex={-1} aria-hidden="true" aria-label={fieldLabel} value={value} disabled={disabled} required={required} onFocus={focusTrigger} onInvalid={(event) => { event.preventDefault(); setInvalid(true); focusTrigger() }} onPointerDown={(event) => event.preventDefault()} onClick={(event) => event.preventDefault()} onChange={(event) => onChange({ target: { value: event.target.value } })}>{children}</select>
    <div ref={triggerRef} role="combobox" tabIndex={disabled ? -1 : 0} className="select-trigger" aria-label={triggerLabel} aria-disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-listbox` : undefined} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined} aria-required={required} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} onBlur={(event) => {
      if (!menuRef.current?.contains(event.relatedTarget as Node)) setOpen(false)
    }} onPointerDown={(event) => { event.preventDefault(); if (!disabled) focusTrigger() }} onClick={(event) => {
      // Select 常被包在 label 中；阻止 label 在 iOS 上继续激活隐藏的原生选择器。
      event.preventDefault()
      if (disabled) return
      focusTrigger()
      if (open) setOpen(false); else showMenu()
    }} onKeyDown={(event) => {
      if (disabled) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!open) showMenu(); else move(event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!open) showMenu(); else if (options[active] && !options[active].disabled) choose(options[active].value)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const index = event.key === 'Home' ? options.findIndex((item) => !item.disabled) : options.findLastIndex((item) => !item.disabled)
        if (!open) showMenu(index); else setActive(index)
      } else if (event.key === 'Escape' && open) {
        // 只关闭最上层下拉，避免同一个 Escape 同时关闭所在抽屉。
        event.preventDefault(); event.stopPropagation(); setOpen(false)
      } else if (event.key === 'Tab') {
        setOpen(false)
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now()
        searchRef.current = { text: (now - searchRef.current.time < 700 ? searchRef.current.text : '') + event.key.toLocaleLowerCase(), time: now }
        const index = options.findIndex((item) => !item.disabled && optionText(item.label).toLocaleLowerCase().startsWith(searchRef.current.text))
        if (index >= 0) { event.preventDefault(); if (!open) showMenu(index); else setActive(index) }
      }
    }}>{displayLabel ?? selected?.label ?? '请选择'}<DropdownChevron open={open} /></div>
    {invalid && <span id={`${id}-error`} className="select-validation-error" role="alert">请选择{fieldLabel ?? '一项'}。</span>}
    {open && createPortal(<div id={`${id}-listbox`} ref={menuRef} className="select-menu select-menu--portal dropdown-portal" style={menuStyle} role="listbox" aria-label={fieldLabel ?? '选项'}>{options.map((option, index) => <button id={`${id}-${index}`} key={`${option.value}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={option.value === value} disabled={option.disabled} className={index === active ? 'is-active' : ''} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index) }} onClick={() => choose(option.value)}>{option.label}</button>)}</div>, document.body)}
  </div>
}
