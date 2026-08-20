import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDropdownPosition } from './useDropdownPosition'

interface OptionProps { value?: string; disabled?: boolean; children?: ReactNode }
interface SelectChange { target: { value: string } }

export interface SelectProps {
  value: string
  onChange: (event: SelectChange) => void
  children: ReactNode
  disabled?: boolean
  required?: boolean
  className?: string
}

export function Select({ value, onChange, children, disabled, required, className }: SelectProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = Children.toArray(children).filter(isValidElement).map((node) => {
    const option = node as ReactElement<OptionProps>
    return { value: String(option.props.value ?? ''), label: option.props.children, disabled: option.props.disabled }
  })
  const [open, setOpen] = useState(false)
  const [accessibleLabel, setAccessibleLabel] = useState<string>()
  const [active, setActive] = useState(Math.max(0, options.findIndex((item) => item.value === value)))
  const menuStyle = useDropdownPosition(triggerRef, open)
  const selected = options.find((item) => item.value === value)

  useLayoutEffect(() => {
    const label = rootRef.current?.closest('label')?.querySelector(':scope > span')?.textContent?.trim()
    if (label) setAccessibleLabel(label)
  }, [])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) { setOpen(false); triggerRef.current?.focus() }
    }
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('homebuild-dropdown-open', other)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('homebuild-dropdown-open', other)
    }
  }, [id, open])

  const choose = (next: string) => { onChange({ target: { value: next } }); setOpen(false); triggerRef.current?.focus() }
  const move = (step: number) => {
    let next = active
    do next = (next + step + options.length) % options.length
    while (options[next]?.disabled && next !== active)
    setActive(next)
  }
  return <div ref={rootRef} className={`select-control${className ? ` ${className}` : ''}`}>
    <select className="select-native-proxy" tabIndex={-1} aria-label={accessibleLabel} value={value} disabled={disabled} required={required} onChange={(event) => onChange({ target: { value: event.target.value } })}>{children}</select>
    <div ref={triggerRef} role="button" tabIndex={disabled ? -1 : 0} className="select-trigger" aria-disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-required={required} onClick={() => {
      if (disabled) return
      const next = !open; setOpen(next)
      if (next) window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: id }))
    }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) { setOpen(true); window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: id })) } move(event.key === 'ArrowDown' ? 1 : -1) }
      if (event.key === 'Enter' && open && options[active] && !options[active].disabled) { event.preventDefault(); choose(options[active].value) }
    }}>{selected?.label ?? '请选择'}<span aria-hidden="true">⌄</span></div>
    {open && createPortal(<div ref={menuRef} className="select-menu select-menu--portal dropdown-portal" style={menuStyle} role="listbox" aria-activedescendant={`${id}-${active}`}>{options.map((option, index) => <button id={`${id}-${index}`} key={`${option.value}-${index}`} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className={index === active ? 'is-active' : ''} onPointerMove={() => setActive(index)} onClick={() => choose(option.value)}>{option.label}</button>)}</div>, document.body)}
  </div>
}
