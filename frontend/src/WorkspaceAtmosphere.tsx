import { useEffect } from 'react'

export const IMMERSIVE_TILT_CLASS = 'immersive-tilt'

const reduceMotionQuery = '(prefers-reduced-motion: reduce)'
const coarsePointerQuery = '(hover: none), (pointer: coarse)'

function resetTilt(element: HTMLElement | null) {
  if (!element) return
  element.style.removeProperty('--tilt-x')
  element.style.removeProperty('--tilt-y')
  element.style.removeProperty('--tilt-lift')
  element.removeAttribute('data-tilting')
}

/** 仅委托展示卡片的倾斜交互，不创建背景粒子或持续绘制循环。 */
export function WorkspaceAtmosphere() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const motionMedia = window.matchMedia(reduceMotionQuery)
    const coarseMedia = window.matchMedia(coarsePointerQuery)
    let pointerFrame = 0
    let activeTilt: HTMLElement | null = null

    const schedulePointerUpdate = (event: PointerEvent) => {
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0
        const target = event.target instanceof Element ? event.target : null
        const insideContent = target?.closest('.workspace-content')
        const blocksTilt = target?.closest('input, textarea, select, [role="dialog"], .select-menu, .multi-select-options, .source-picker__menu')
        const allowPointerEffects = !coarseMedia.matches && !motionMedia.matches && insideContent && !blocksTilt

        const nextTilt = allowPointerEffects ? target?.closest<HTMLElement>(`.${IMMERSIVE_TILT_CLASS}`) ?? null : null
        if (activeTilt !== nextTilt) resetTilt(activeTilt)
        activeTilt = nextTilt
        if (!activeTilt) return

        const rect = activeTilt.getBoundingClientRect()
        const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
        const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2))
        activeTilt.style.setProperty('--tilt-x', `${(-y * 3.5).toFixed(2)}deg`)
        activeTilt.style.setProperty('--tilt-y', `${(x * 3.5).toFixed(2)}deg`)
        activeTilt.style.setProperty('--tilt-lift', '-3px')
        activeTilt.setAttribute('data-tilting', '')
      })
    }

    const clearPointerEffects = () => {
      resetTilt(activeTilt)
      activeTilt = null
    }

    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointerEffects()
    }

    window.addEventListener('pointermove', schedulePointerUpdate, { passive: true })
    window.addEventListener('pointerout', handlePointerOut, { passive: true })

    motionMedia.addEventListener?.('change', clearPointerEffects)
    coarseMedia.addEventListener?.('change', clearPointerEffects)
    return () => {
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
      resetTilt(activeTilt)
      window.removeEventListener('pointermove', schedulePointerUpdate)
      window.removeEventListener('pointerout', handlePointerOut)
      motionMedia.removeEventListener?.('change', clearPointerEffects)
      coarseMedia.removeEventListener?.('change', clearPointerEffects)
    }
  }, [])

  return null
}
