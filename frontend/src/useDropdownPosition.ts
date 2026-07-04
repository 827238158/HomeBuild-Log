import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

const VIEWPORT_GAP = 8
const MENU_GAP = 6
const MIN_USEFUL_HEIGHT = 180

export function useDropdownPosition(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  preferredMaxHeight = 280,
) {
  const [style, setStyle] = useState<CSSProperties>({})

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - VIEWPORT_GAP - MENU_GAP)
    const spaceAbove = Math.max(0, rect.top - VIEWPORT_GAP - MENU_GAP)
    const openDown = spaceBelow >= MIN_USEFUL_HEIGHT || spaceBelow >= spaceAbove
    const availableHeight = openDown ? spaceBelow : spaceAbove
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - VIEWPORT_GAP * 2))
    const left = Math.max(VIEWPORT_GAP, Math.min(rect.left, window.innerWidth - width - VIEWPORT_GAP))

    // 使用 fixed + 视口坐标，让 portal 菜单不受卡片 overflow 和层叠上下文影响。
    setStyle({
      position: 'fixed',
      left,
      width,
      maxHeight: Math.min(preferredMaxHeight, availableHeight),
      ...(openDown
        ? { top: rect.bottom + MENU_GAP, bottom: 'auto' }
        : { top: 'auto', bottom: window.innerHeight - rect.top + MENU_GAP }),
    })
  }, [preferredMaxHeight, triggerRef])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    // 捕获任意滚动容器的滚动，并在窗口尺寸变化时持续对齐触发器。
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return style
}
