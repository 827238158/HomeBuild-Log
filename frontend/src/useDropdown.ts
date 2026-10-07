import { useCallback, useEffect, useId, useState, type RefObject } from 'react'

interface DropdownOptions {
  rootRef: RefObject<HTMLElement | null>
  triggerRef: RefObject<HTMLElement | null>
  menuRef: RefObject<HTMLElement | null>
  disabled?: boolean
}

export function useDropdown({ rootRef, triggerRef, menuRef, disabled }: DropdownOptions) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const focusTrigger = useCallback(() => triggerRef.current?.focus({ preventScroll: true }), [triggerRef])
  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) focusTrigger()
  }, [focusTrigger])
  const openMenu = useCallback(() => {
    if (disabled) return
    window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: id }))
    setOpen(true)
  }, [disabled, id])
  const toggleMenu = useCallback(() => {
    if (disabled) return
    focusTrigger()
    if (open) closeMenu(); else openMenu()
  }, [closeMenu, disabled, focusTrigger, open, openMenu])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    const escape = (event: KeyboardEvent) => {
      // 捕获阶段先关闭下拉，避免 Escape 继续关闭下方抽屉。
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
      }
    }
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) closeMenu() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('homebuild-dropdown-open', other)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('homebuild-dropdown-open', other)
    }
  }, [closeMenu, id, menuRef, open, rootRef])

  return { id, open, setOpen, openMenu, closeMenu, toggleMenu, focusTrigger }
}
